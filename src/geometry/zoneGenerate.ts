/**
 * Zone content pipeline (Sprint 4).
 * generateZoneContent → { buildings, driveways, courtyards }
 * Driveways convert to real RoadCenterline (service profile) per SP 4.13130 / SP 42.
 */

import type { Point2D } from '../domain/SceneOrigin';
import type {
  GeneratedBuilding,
  ZoneBuildForm,
  ZoneCourtyard,
  ZoneDriveway,
  ZoneGeneratedContent,
  ZoneRect,
  ZoneType,
} from '../domain/zones';
import {
  FLOOR_HEIGHT_M,
  resolveZoneParams,
  zoneAreaM2,
  zonePolygon,
} from '../domain/zones';
import type { RoadCenterline } from '../domain/roads';

const MIN_FOOTPRINT: Record<string, { w: number; d: number }> = {
  residential: { w: 8, d: 8 },
  commercial: { w: 12, d: 12 },
  industrial: { w: 20, d: 15 },
  park: { w: 0, d: 0 },
  boundary: { w: 0, d: 0 },
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rectFootprint(cx: number, cy: number, w: number, d: number, rot = 0): Point2D[] {
  const hw = w / 2,
    hd = d / 2;
  const corners: Point2D[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  if (Math.abs(rot) < 1e-6) return corners.map((p) => ({ x: p.x + cx, y: p.y + cy }));
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return corners.map((p) => ({ x: p.x * c - p.y * s + cx, y: p.x * s + p.y * c + cy }));
}

function footprintArea(fp: Point2D[]): number {
  let a = 0;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) a += fp[j].x * fp[i].y - fp[i].x * fp[j].y;
  return Math.abs(a) * 0.5;
}

function pointInPoly(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y,
      yj = poly[j].y,
      xi = poly[i].x,
      xj = poly[j].x;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function footprintMostlyInside(fp: Point2D[], poly: Point2D[]): boolean {
  if (fp.length < 3) return false;
  let cx = 0,
    cy = 0,
    ok = 0;
  for (const p of fp) {
    cx += p.x;
    cy += p.y;
    if (pointInPoly(p, poly)) ok++;
  }
  cx /= fp.length;
  cy /= fp.length;
  if (!pointInPoly({ x: cx, y: cy }, poly)) return false;
  return ok >= Math.ceil(fp.length * 0.75);
}

function aabbOf(fp: Point2D[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of fp) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function aabbOverlap(a: ReturnType<typeof aabbOf>, b: ReturnType<typeof aabbOf>, gap = 0.5): boolean {
  return !(a.maxX + gap < b.minX || b.maxX + gap < a.minX || a.maxY + gap < b.minY || b.maxY + gap < a.minY);
}

function insetBBox(minX: number, maxX: number, minY: number, maxY: number, setback: number) {
  const nx = minX + setback,
    xx = maxX - setback,
    ny = minY + setback,
    xy = maxY - setback;
  if (xx - nx < 4 || xy - ny < 4) return null;
  return { minX: nx, maxX: xx, minY: ny, maxY: xy };
}

function uid(prefix: string, i: number, seed: number): string {
  return `${prefix}-${(seed ^ (i * 2654435761)) >>> 0}`;
}

function heightFromFar(far: number, parcelArea: number, fpArea: number, maxFloors: number, floorH: number) {
  if (fpArea < 1 || far <= 0) return { heightM: floorH, floors: 1 };
  let floors = Math.max(1, Math.round((far * parcelArea) / fpArea));
  floors = Math.min(floors, Math.max(1, maxFloors));
  return { heightM: floors * floorH, floors };
}

interface ParcelCell {
  cx: number;
  cy: number;
  w: number;
  d: number;
  parcelArea: number;
  rot?: number;
}

function signedArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a * 0.5;
}

function polyCentroid(poly: Point2D[]): Point2D {
  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / poly.length, y: cy / poly.length };
}

function unit(dx: number, dy: number): Point2D {
  const L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}

function filterCenterlineInside(pts: Point2D[], poly: Point2D[]): Point2D[] {
  const kept = pts.filter((p) => pointInPoly(p, poly));
  return kept.length >= 2 ? kept : [];
}

function principalAxis(poly: Point2D[]): { ux: number; uy: number; len: number } {
  let best = 0,
    ux = 1,
    uy = 0;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const dx = poly[j].x - poly[i].x,
        dy = poly[j].y - poly[i].y;
      const len = Math.hypot(dx, dy);
      if (len > best) {
        best = len;
        ux = dx / len;
        uy = dy / len;
      }
    }
  }
  return { ux, uy, len: best };
}

/** SP 4.13130: fire lane width 3.5–4.2 m → service profile ~4.0 m carriageway. */
const DRIVE_HALF_W = 2.0;

function portAt(p: Point2D, tangent: Point2D): { point: Point2D; tangent: Point2D } {
  return { point: { ...p }, tangent: { ...tangent } };
}

function cleanLine(pts: Point2D[], minSeg = 1.2): Point2D[] {
  if (pts.length < 2) return [];
  const out: Point2D[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const d = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
    if (d >= minSeg) out.push({ ...pts[i] });
  }
  if (out.length < 2) return [];
  return out;
}

/**
 * SP-aware internal driveways / fire lanes (centerlines strictly inside zone).
 * Perimeter: U in courtyard + spur to outer contour.
 * Tower: spur + hammerhead. Corridor: parallel access. Random: spur.
 */
function layoutDriveways(
  zoneId: string,
  poly: Point2D[],
  form: ZoneBuildForm,
  setbackM: number,
  seed: number
): ZoneDriveway[] {
  if (form === 'open' || poly.length < 3) return [];
  const area = Math.abs(signedArea(poly));
  if (area < 120) return [];

  const centroid = polyCentroid(poly);
  const halfW = DRIVE_HALF_W;
  const edgeInset = Math.max(setbackM, 2) + halfW + 0.5;

  let bestLen = 0;
  let entryA = poly[0];
  let entryB = poly[1 % poly.length];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      entryA = a;
      entryB = b;
    }
  }
  const edgeMid = { x: (entryA.x + entryB.x) / 2, y: (entryA.y + entryB.y) / 2 };
  const edgeU = unit(entryB.x - entryA.x, entryB.y - entryA.y);
  let nx = -edgeU.y;
  let ny = edgeU.x;
  if (nx * (centroid.x - edgeMid.x) + ny * (centroid.y - edgeMid.y) < 0) {
    nx = -nx;
    ny = -ny;
  }

  const portPt = { x: edgeMid.x, y: edgeMid.y };
  const entry = { x: edgeMid.x + nx * edgeInset, y: edgeMid.y + ny * edgeInset };
  if (!pointInPoly(entry, poly)) return [];

  const { ux, uy, len: longLen } = principalAxis(poly);
  const px = -uy;
  const py = ux;
  const char = Math.sqrt(area);
  const out: ZoneDriveway[] = [];
  const idBase = uid(`${zoneId}-drv`, 0, seed);

  if (form === 'tower') {
    const stopDist = Math.min(12, char * 0.12);
    const stop = { x: centroid.x - nx * stopDist, y: centroid.y - ny * stopDist };
    const arm = Math.min(7, char * 0.08);
    const headL = { x: stop.x - edgeU.x * arm, y: stop.y - edgeU.y * arm };
    const headR = { x: stop.x + edgeU.x * arm, y: stop.y + edgeU.y * arm };
    let pts = cleanLine(filterCenterlineInside([portPt, entry, stop, headL, stop, headR], poly), 1.0);
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([portPt, entry, stop], poly));
    if (pts.length >= 2) {
      const tanIn = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      out.push({
        id: idBase,
        zoneId,
        centerline: pts,
        halfWidthM: halfW,
        kind: 'fire',
        ports: [portAt(pts[0], { x: -tanIn.x, y: -tanIn.y })],
      });
    }
    return out;
  }

  if (form === 'corridor') {
    const halfLen = Math.min(longLen * 0.38, 45);
    const offset = Math.min(12, char * 0.1) + halfW;
    const c = { x: centroid.x + px * offset, y: centroid.y + py * offset };
    const a = { x: c.x - ux * halfLen, y: c.y - uy * halfLen };
    const b = { x: c.x + ux * halfLen, y: c.y + uy * halfLen };
    let pts = cleanLine(filterCenterlineInside([portPt, entry, a, b], poly));
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([a, b], poly));
    if (pts.length >= 2) {
      const tan0 = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const tan1 = unit(last.x - prev.x, last.y - prev.y);
      out.push({
        id: idBase,
        zoneId,
        centerline: pts,
        halfWidthM: halfW,
        kind: 'access',
        ports: [portAt(pts[0], { x: -tan0.x, y: -tan0.y }), portAt(last, tan1)],
      });
    }
    return out;
  }

  if (form === 'block') {
    const depth = Math.min(longLen * 0.32, char * 0.26, 32);
    const halfSpan = Math.min(longLen * 0.28, char * 0.22, 26);
    const near = {
      x: edgeMid.x + nx * (edgeInset + Math.min(6, depth * 0.25)),
      y: edgeMid.y + ny * (edgeInset + Math.min(6, depth * 0.25)),
    };
    const far = { x: edgeMid.x + nx * (edgeInset + depth), y: edgeMid.y + ny * (edgeInset + depth) };
    const nearL = { x: near.x - edgeU.x * halfSpan, y: near.y - edgeU.y * halfSpan };
    const nearR = { x: near.x + edgeU.x * halfSpan, y: near.y + edgeU.y * halfSpan };
    const farL = { x: far.x - edgeU.x * halfSpan, y: far.y - edgeU.y * halfSpan };
    const farR = { x: far.x + edgeU.x * halfSpan, y: far.y + edgeU.y * halfSpan };
    const raw = [portPt, entry, near, nearL, farL, farR, nearR, near];
    let pts = cleanLine(filterCenterlineInside(raw, poly), 1.5);
    if (pts.length < 3) {
      pts = cleanLine(filterCenterlineInside([portPt, entry, nearL, farL, farR, nearR], poly), 1.5);
    }
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([portPt, entry, far], poly));
    if (pts.length >= 2) {
      const tan0 = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      out.push({
        id: idBase,
        zoneId,
        centerline: pts,
        halfWidthM: halfW,
        kind: 'fire',
        ports: [portAt(pts[0], { x: -tan0.x, y: -tan0.y })],
      });
    }
    return out;
  }

  {
    const stop = { x: centroid.x * 0.55 + entry.x * 0.45, y: centroid.y * 0.55 + entry.y * 0.45 };
    let pts = cleanLine(filterCenterlineInside([portPt, entry, stop], poly));
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([entry, centroid], poly));
    if (pts.length >= 2) {
      const tanIn = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      out.push({
        id: `${idBase}-a`,
        zoneId,
        centerline: pts,
        halfWidthM: halfW,
        kind: 'access',
        ports: [portAt(pts[0], { x: -tanIn.x, y: -tanIn.y })],
      });
    }
  }
  return out;
}

/** Convert zone driveways → real RoadCenterline (profile service, СП ~4 m). */
export function drivewaysToRoads(driveways: ZoneDriveway[]): RoadCenterline[] {
  return driveways
    .filter((d) => d.centerline.length >= 2)
    .map((d) => ({
      id: d.id,
      points: d.centerline.map((p) => ({ x: p.x, y: p.y })),
      profileId: 'service' as const,
      options: { lanes: 1, sidewalkM: 0, parkingM: 0, greenBufferM: 0 },
      tags: {
        zoneId: d.zoneId,
        zoneDrive: d.kind,
        highway: 'service',
        name: d.kind === 'fire' ? 'Fire lane' : 'Access drive',
      },
    }));
}

function shrinkPolyTowardCentroid(poly: Point2D[], insetM: number): Point2D[] | null {
  if (poly.length < 3 || insetM <= 0) return poly.map((p) => ({ ...p }));
  const c = polyCentroid(poly);
  const out: Point2D[] = [];
  for (const p of poly) {
    const dx = p.x - c.x,
      dy = p.y - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < insetM + 1) return null;
    const s = 1 - insetM / dist;
    out.push({ x: c.x + dx * s, y: c.y + dy * s });
  }
  let ok = 0;
  for (const p of out) if (pointInPoly(p, poly)) ok++;
  if (ok < out.length * 0.75) return null;
  if (Math.abs(signedArea(out)) < 40) return null;
  return out;
}

function scatterTrees(
  poly: Point2D[],
  seed: number,
  densityPerHa: number,
  minSpacingM: number
): { x: number; y: number }[] {
  const area = Math.abs(signedArea(poly));
  if (area < 30) return [];
  const target = Math.max(1, Math.round((area / 10_000) * densityPerHa));
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const trees: { x: number; y: number }[] = [];
  let attempts = 0;
  while (trees.length < target && attempts < target * 40) {
    attempts++;
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (!pointInPoly({ x, y }, poly)) continue;
    let far = true;
    for (const t of trees) {
      if (Math.hypot(t.x - x, t.y - y) < minSpacingM) {
        far = false;
        break;
      }
    }
    if (!far) continue;
    trees.push({ x, y });
  }
  return trees;
}

function layoutCourtyards(
  zoneId: string,
  poly: Point2D[],
  form: ZoneBuildForm,
  setbackM: number,
  seed: number,
  _driveways: ZoneDriveway[]
): ZoneCourtyard[] {
  if (poly.length < 3) return [];
  const area = Math.abs(signedArea(poly));
  if (area < 100) return [];
  const centroid = polyCentroid(poly);
  const out: ZoneCourtyard[] = [];
  const idBase = uid(`${zoneId}-court`, 0, seed);
  const edgePad = Math.max(setbackM, 2) + 1.5;

  if (form === 'block') {
    const inner = shrinkPolyTowardCentroid(poly, edgePad + 14);
    if (inner)
      out.push({
        id: idBase,
        zoneId,
        polygon: inner,
        kind: 'court',
        trees: scatterTrees(inner, seed, 45, 6),
      });
    return out;
  }
  if (form === 'tower') {
    const plaza = shrinkPolyTowardCentroid(poly, edgePad + 6);
    if (plaza) {
      out.push({
        id: idBase,
        zoneId,
        polygon: plaza,
        kind: 'plaza',
        trees: scatterTrees(plaza, seed, 25, 8).filter(
          (t) => Math.hypot(t.x - centroid.x, t.y - centroid.y) > 8
        ),
      });
    }
    return out;
  }
  if (form === 'corridor') {
    const { ux, uy, len: longLen } = principalAxis(poly);
    const px = -uy,
      py = ux;
    const halfLen = Math.min(longLen * 0.3, 35);
    const halfW = Math.min(Math.sqrt(area) * 0.12, 12);
    const offset = Math.min(14, Math.sqrt(area) * 0.1);
    const c = { x: centroid.x - px * offset, y: centroid.y - py * offset };
    const corners = [
      { x: c.x - ux * halfLen - px * halfW, y: c.y - uy * halfLen - py * halfW },
      { x: c.x + ux * halfLen - px * halfW, y: c.y + uy * halfLen - py * halfW },
      { x: c.x + ux * halfLen + px * halfW, y: c.y + uy * halfLen + py * halfW },
      { x: c.x - ux * halfLen + px * halfW, y: c.y - uy * halfLen + py * halfW },
    ];
    if (corners.every((p) => pointInPoly(p, poly))) {
      out.push({
        id: idBase,
        zoneId,
        polygon: corners,
        kind: 'green',
        trees: scatterTrees(corners, seed, 35, 6),
      });
    }
    return out;
  }
  if (form === 'open') {
    const green = shrinkPolyTowardCentroid(poly, edgePad);
    if (green)
      out.push({
        id: idBase,
        zoneId,
        polygon: green,
        kind: 'green',
        trees: scatterTrees(green, seed, 60, 5),
      });
    return out;
  }
  const patch = shrinkPolyTowardCentroid(poly, edgePad + 8);
  if (patch)
    out.push({
      id: idBase,
      zoneId,
      polygon: patch,
      kind: 'green',
      trees: scatterTrees(patch, seed, 30, 7),
    });
  return out;
}

interface GenerateOptions {
  roads?: { points: Point2D[]; halfWidthM: number }[];
}

function isNearlyRect(poly: Point2D[]): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i],
      b = poly[(i + 1) % 4];
    const dx = Math.abs(b.x - a.x),
      dy = Math.abs(b.y - a.y);
    if (dx > 0.5 && dy > 0.5) return false;
  }
  return true;
}

function parcelizePerimeterAlongEdges(
  poly: Point2D[],
  setbackM: number,
  parcelDepthM: number,
  coverage: number,
  minW: number,
  minD: number
): ParcelCell[] {
  if (poly.length < 3) return [];
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const ccw = signedArea(poly) > 0;
  const centroid = polyCentroid(poly);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const charSize = Math.min(maxX - minX, maxY - minY);
  if (charSize < 10) return [];
  let depth = Math.min(parcelDepthM, charSize * 0.28, Math.max(minD, 10));
  depth = Math.max(4, depth);
  let perimeter = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const ringApprox = perimeter * depth;
  const covScale = Math.min(1, Math.max(0.55, (coverage * area) / Math.max(1, ringApprox)));
  depth = Math.max(4, depth * Math.sqrt(covScale));
  const insetDist = setbackM + depth / 2 + 0.3;
  const cornerCut = depth * 0.65 + setbackM * 0.25;
  const cells: ParcelCell[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < minW * 0.6) continue;
    const ux = dx / edgeLen,
      uy = dy / edgeLen;
    let nx = ccw ? -uy : uy,
      ny = ccw ? ux : -ux;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const toC = { x: centroid.x - mid.x, y: centroid.y - mid.y };
    if (nx * toC.x + ny * toC.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const usable = edgeLen - 2 * cornerCut;
    if (usable < minW * 0.5) continue;
    cells.push({
      cx: mid.x + nx * insetDist,
      cy: mid.y + ny * insetDist,
      w: usable,
      d: depth,
      parcelArea: area / n,
      rot: Math.atan2(uy, ux),
    });
  }
  return cells;
}

function parcelizePerimeterRect(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number,
  coverage: number,
  minD: number
): ParcelCell[] {
  const W = box.maxX - box.minX,
    D = box.maxY - box.minY,
    area = Math.max(1, W * D);
  if (W < 8 || D < 8) return [];
  let depth = Math.min(Math.max(parcelDepthM, minD), Math.min(W, D) * 0.32);
  depth = Math.max(4, Math.min(depth, Math.min(W, D) * 0.38 - 1));
  if (W < depth * 2 + 6 || D < depth * 2 + 6) {
    return [
      {
        cx: (box.minX + box.maxX) / 2,
        cy: (box.minY + box.maxY) / 2,
        w: W * 0.9,
        d: D * 0.9,
        parcelArea: area,
      },
    ];
  }
  const pad = 0.2;
  const x0 = box.minX + pad,
    x1 = box.maxX - pad,
    y0 = box.minY + pad,
    y1 = box.maxY - pad;
  const iW = x1 - x0,
    iD = y1 - y0;
  const ringArea = 2 * (iW + iD) * depth - 4 * depth * depth;
  const scale = Math.min(1, Math.max(0.5, (coverage * area) / Math.max(1, ringArea)));
  let dUse = Math.max(4, Math.min(depth * Math.sqrt(scale), Math.min(iW, iD) * 0.38));
  const cells: ParcelCell[] = [],
    share = area / 4;
  cells.push({ cx: (x0 + x1) / 2, cy: y0 + dUse / 2, w: iW, d: dUse, parcelArea: share });
  cells.push({ cx: (x0 + x1) / 2, cy: y1 - dUse / 2, w: iW, d: dUse, parcelArea: share });
  const gap = iD - 2 * dUse;
  if (gap >= 3) {
    cells.push({ cx: x0 + dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: gap, parcelArea: share });
    cells.push({ cx: x1 - dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: gap, parcelArea: share });
  }
  return cells;
}

function parcelizeTower(
  poly: Point2D[],
  coverage: number,
  minW: number,
  setbackM: number,
  rng: () => number
): ParcelCell[] {
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const centroid = polyCentroid(poly);
  const jitter = Math.min(3, Math.sqrt(area) * 0.02);
  const cx = centroid.x + (rng() - 0.5) * jitter;
  const cy = centroid.y + (rng() - 0.5) * jitter;
  const targetFp = area * Math.min(0.15, Math.max(0.04, coverage * 0.4));
  let side = Math.max(minW * 0.85, Math.sqrt(targetFp));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const char = Math.min(maxX - minX, maxY - minY) - 2 * Math.max(0, setbackM);
  side = Math.min(side, Math.max(minW * 0.7, char * 0.35));
  const aspect = 0.75 + rng() * 0.35;
  let w = side,
    d = side * aspect;
  const rot = (rng() - 0.5) * ((12 * Math.PI) / 180);
  for (let step = 0; step < 14; step++) {
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (footprintMostlyInside(fp, poly)) return [{ cx, cy, w, d, parcelArea: area, rot }];
    w *= 0.9;
    d *= 0.9;
    if (w < minW * 0.5 || d < minW * 0.5) break;
  }
  const s = Math.max(4, minW * 0.55);
  if (footprintMostlyInside(rectFootprint(centroid.x, centroid.y, s, s, 0), poly)) {
    return [{ cx: centroid.x, cy: centroid.y, w: s, d: s, parcelArea: area, rot: 0 }];
  }
  return [];
}

function parcelizeRandom(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  poly: Point2D[],
  coverage: number,
  minW: number,
  minD: number,
  rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX,
    D = box.maxY - box.minY,
    area = W * D;
  const avgFp = Math.max(minW * minD, 120);
  const targetCount = Math.max(1, Math.round((area * coverage) / avgFp));
  const cells: ParcelCell[] = [];
  const placed: { box: ReturnType<typeof aabbOf> }[] = [];
  let attempts = 0;
  while (cells.length < targetCount && attempts < targetCount * 50) {
    attempts++;
    const w = minW * (1 + rng() * 0.9),
      d = minD * (1 + rng() * 0.9);
    const margin = Math.max(w, d) * 0.55;
    const cx = box.minX + margin + rng() * Math.max(0.1, W - margin * 2);
    const cy = box.minY + margin + rng() * Math.max(0.1, D - margin * 2);
    const rot = (rng() - 0.5) * ((20 * Math.PI) / 180);
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (!footprintMostlyInside(fp, poly)) continue;
    const boxFp = aabbOf(fp);
    if (placed.some((p) => aabbOverlap(p.box, boxFp))) continue;
    cells.push({ cx, cy, w, d, parcelArea: area / targetCount, rot });
    placed.push({ box: boxFp });
  }
  return cells;
}

function parcelizeCorridor(
  poly: Point2D[],
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number,
  coverage: number,
  minW: number,
  setbackM: number
): ParcelCell[] {
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const { ux, uy, len: longLen } = principalAxis(poly);
  const px = -uy,
    py = ux;
  const depth = Math.min(parcelDepthM, Math.sqrt(area) * 0.22, 28);
  const halfLen = Math.min(longLen * 0.42, Math.sqrt(area) * 0.4);
  const offset = depth / 2 + Math.max(1, setbackM * 0.3);
  const centroid = polyCentroid(poly);
  const cells: ParcelCell[] = [];
  for (const sign of [-1, 1] as const) {
    const cx = centroid.x + px * offset * sign;
    const cy = centroid.y + py * offset * sign;
    const w = Math.max(minW, halfLen * 2 * 0.9);
    const d = depth;
    const rot = Math.atan2(uy, ux);
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (footprintMostlyInside(fp, poly)) {
      cells.push({ cx, cy, w, d, parcelArea: area / 2, rot });
    }
  }
  return cells;
}

export function generateZoneContent(
  zone: ZoneRect,
  opts: GenerateOptions = {}
): ZoneGeneratedContent {
  const empty: ZoneGeneratedContent = { buildings: [], driveways: [], courtyards: [] };
  if (zone.type === 'boundary' || zone.type === 'park') return empty;

  const params = resolveZoneParams(zone);
  if (params.buildForm === 'open' || params.coverage <= 0 || params.far <= 0) {
    return empty;
  }

  const poly = zonePolygon(zone);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const setback = Math.max(0, params.setbackM);
  const inset = insetBBox(minX, maxX, minY, maxY, setback);
  const rng = mulberry32(params.seed);
  const min = MIN_FOOTPRINT[zone.type] ?? MIN_FOOTPRINT.residential;

  const driveways = layoutDriveways(zone.id, poly, params.buildForm, setback, params.seed);
  const courtyards = layoutCourtyards(zone.id, poly, params.buildForm, setback, params.seed, driveways);

  let cells: ParcelCell[] = [];
  switch (params.buildForm) {
    case 'tower':
      cells = parcelizeTower(poly, params.coverage, min.w, setback, rng);
      break;
    case 'random':
      if (!inset) break;
      cells = parcelizeRandom(inset, poly, params.coverage, min.w, min.d, rng);
      break;
    case 'corridor': {
      const boxForCorridor = inset ?? { minX, maxX, minY, maxY };
      cells = parcelizeCorridor(poly, boxForCorridor, params.parcelDepthM, params.coverage, min.w, setback);
      break;
    }
    case 'block':
    default: {
      if (isNearlyRect(poly) && inset) {
        cells = parcelizePerimeterRect(inset, params.parcelDepthM, params.coverage, min.d);
      } else {
        cells = parcelizePerimeterAlongEdges(
          poly,
          setback,
          params.parcelDepthM,
          params.coverage,
          min.w,
          min.d
        );
      }
      if (!cells.length && inset) {
        cells = parcelizePerimeterRect(inset, params.parcelDepthM, params.coverage, min.d);
      }
      break;
    }
  }

  const buildings: GeneratedBuilding[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const rot = cell.rot ?? 0;
    let w = cell.w;
    let d = cell.d;
    let fp = rectFootprint(cell.cx, cell.cy, w, d, rot);
    let fpA = footprintArea(fp);
    if (fpA < 4) continue;
    if (!footprintMostlyInside(fp, poly)) {
      w *= 0.9;
      d *= 0.9;
      fp = rectFootprint(cell.cx, cell.cy, w, d, rot);
      fpA = footprintArea(fp);
      if (!footprintMostlyInside(fp, poly)) {
        w *= 0.9;
        d *= 0.9;
        fp = rectFootprint(cell.cx, cell.cy, w, d, rot);
        fpA = footprintArea(fp);
        if (!footprintMostlyInside(fp, poly)) continue;
      }
    }
    let { heightM, floors } = heightFromFar(
      params.far,
      cell.parcelArea,
      fpA,
      params.maxFloors,
      FLOOR_HEIGHT_M
    );
    if (params.buildForm === 'random') {
      const factor = 0.55 + rng() * 0.9;
      floors = Math.max(1, Math.min(params.maxFloors, Math.round(floors * factor)));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    if (params.buildForm === 'tower') {
      floors = Math.max(floors, Math.min(params.maxFloors, Math.max(6, Math.round(params.maxFloors * 0.9))));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    buildings.push({
      id: uid(zone.id, i, params.seed),
      zoneId: zone.id,
      footprint: fp,
      heightM,
      floors,
      type: zone.type,
      buildForm: params.buildForm,
    });
  }
  void opts;
  return { buildings, driveways, courtyards };
}

export function generateBuildingsForZone(zone: ZoneRect, opts: GenerateOptions = {}): GeneratedBuilding[] {
  return generateZoneContent(zone, opts).buildings;
}

export function actualFar(buildings: GeneratedBuilding[], zone: ZoneRect): number {
  const area = zoneAreaM2(zone);
  if (area < 1) return 0;
  let gfa = 0;
  for (const b of buildings) gfa += footprintArea(b.footprint) * b.floors;
  return gfa / area;
}

export function styleFromZoneType(t: ZoneType): 'residential' | 'office' | 'industrial' | 'generic' {
  if (t === 'residential') return 'residential';
  if (t === 'commercial') return 'office';
  if (t === 'industrial') return 'industrial';
  return 'generic';
}

export type { ZoneBuildForm };
