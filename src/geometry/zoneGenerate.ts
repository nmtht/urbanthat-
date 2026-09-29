/**
 * Zone content pipeline (Sprint 4).
 * generateZoneContent → { buildings, driveways, courtyards }
 * Driveways convert to real RoadCenterline (service profile) per SP 4.13130 / SP 42.
 * Massing: no overlap zone/drives/courts/peers; aspect limits; FAR via height not packing.
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

const BLDG_DRIVE_CLEAR_M = 6.0;
const BLDG_GAP_M = 4.0;
const MAX_BAR_LEN_M = 42;
const MAX_ASPECT = 4.0;
const MIN_BLDG_SIDE = 7;
const DRIVE_HALF_W = 2.0;

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
  const hw = w / 2, hd = d / 2;
  const corners: Point2D[] = [
    { x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd },
  ];
  if (Math.abs(rot) < 1e-6) return corners.map((p) => ({ x: p.x + cx, y: p.y + cy }));
  const c = Math.cos(rot), s = Math.sin(rot);
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
    const yi = poly[i].y, yj = poly[j].y, xi = poly[i].x, xj = poly[j].x;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function footprintMostlyInside(fp: Point2D[], poly: Point2D[]): boolean {
  if (fp.length < 3) return false;
  let cx = 0, cy = 0, ok = 0;
  for (const p of fp) { cx += p.x; cy += p.y; if (pointInPoly(p, poly)) ok++; }
  cx /= fp.length; cy /= fp.length;
  if (!pointInPoly({ x: cx, y: cy }, poly)) return false;
  return ok >= Math.ceil(fp.length * 0.75);
}

function footprintFullyInside(fp: Point2D[], poly: Point2D[]): boolean {
  if (fp.length < 3) return false;
  let cx = 0, cy = 0;
  for (const p of fp) {
    if (!pointInPoly(p, poly)) return false;
    cx += p.x; cy += p.y;
  }
  return pointInPoly({ x: cx / fp.length, y: cy / fp.length }, poly);
}

function aabbOf(fp: Point2D[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of fp) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function aabbOverlap(a: ReturnType<typeof aabbOf>, b: ReturnType<typeof aabbOf>, gap = 0.5): boolean {
  return !(a.maxX + gap < b.minX || b.maxX + gap < a.minX || a.maxY + gap < b.minY || b.maxY + gap < a.minY);
}

function insetBBox(minX: number, maxX: number, minY: number, maxY: number, setback: number) {
  const nx = minX + setback, xx = maxX - setback, ny = minY + setback, xy = maxY - setback;
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
  cx: number; cy: number; w: number; d: number; parcelArea: number; rot?: number;
}

function signedArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a * 0.5;
}

function polyCentroid(poly: Point2D[]): Point2D {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
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
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const dx = poly[j].x - poly[i].x, dy = poly[j].y - poly[i].y;
      const len = Math.hypot(dx, dy);
      if (len > best) { best = len; ux = dx / len; uy = dy / len; }
    }
  }
  return { ux, uy, len: best };
}

function distPointToSeg(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function minDistToPolyline(p: Point2D, line: Point2D[]): number {
  if (line.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, distPointToSeg(p, line[i], line[i + 1]));
  return best;
}

function footprintHitsDriveway(fp: Point2D[], drives: ZoneDriveway[]): boolean {
  for (const d of drives) {
    const need = d.halfWidthM + BLDG_DRIVE_CLEAR_M;
    for (const p of fp) if (minDistToPolyline(p, d.centerline) < need) return true;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (minDistToPolyline(mid, d.centerline) < need) return true;
    }
  }
  return false;
}

function footprintHitsCourtyard(fp: Point2D[], courts: ZoneCourtyard[]): boolean {
  for (const c of courts) {
    if (c.polygon.length < 3) continue;
    for (const p of fp) if (pointInPoly(p, c.polygon)) return true;
    if (pointInPoly(polyCentroid(c.polygon), fp)) return true;
    if (aabbOverlap(aabbOf(fp), aabbOf(c.polygon), 1.5)) {
      for (const p of c.polygon) if (pointInPoly(p, fp)) return true;
    }
  }
  return false;
}

function polysOverlap(a: Point2D[], b: Point2D[], gap = BLDG_GAP_M): boolean {
  if (!aabbOverlap(aabbOf(a), aabbOf(b), gap)) return false;
  for (const p of a) if (pointInPoly(p, b)) return true;
  for (const p of b) if (pointInPoly(p, a)) return true;
  const ca = polyCentroid(a), cb = polyCentroid(b);
  return pointInPoly(ca, b) || pointInPoly(cb, a);
}

function normalizeCellDims(w: number, d: number, minSide: number): { w: number; d: number } {
  let ww = Math.max(minSide, w), dd = Math.max(minSide, d);
  if (dd < MIN_BLDG_SIDE) dd = MIN_BLDG_SIDE;
  if (ww < MIN_BLDG_SIDE) ww = MIN_BLDG_SIDE;
  const aspect = Math.max(ww, dd) / Math.max(1e-6, Math.min(ww, dd));
  if (aspect > MAX_ASPECT) {
    if (ww >= dd) ww = dd * MAX_ASPECT;
    else dd = ww * MAX_ASPECT;
  }
  if (ww > MAX_BAR_LEN_M) ww = MAX_BAR_LEN_M;
  if (dd > MAX_BAR_LEN_M) dd = MAX_BAR_LEN_M;
  return { w: ww, d: dd };
}

function segmentLongCell(cell: ParcelCell, minSide: number): ParcelCell[] {
  const { w, d } = normalizeCellDims(cell.w, cell.d, minSide);
  if (w <= MAX_BAR_LEN_M + 1) return [{ ...cell, w, d }];
  const rot = cell.rot ?? 0;
  const ux = Math.cos(rot), uy = Math.sin(rot);
  const gap = BLDG_GAP_M;
  const n = Math.max(2, Math.ceil((w + gap) / (MAX_BAR_LEN_M + gap)));
  const segW = (w - gap * (n - 1)) / n;
  if (segW < minSide * 0.85) return [{ ...cell, w: Math.min(w, MAX_BAR_LEN_M), d }];
  const out: ParcelCell[] = [];
  const start = -w / 2 + segW / 2;
  for (let i = 0; i < n; i++) {
    const along = start + i * (segW + gap);
    out.push({
      cx: cell.cx + ux * along, cy: cell.cy + uy * along,
      w: segW, d, parcelArea: cell.parcelArea / n, rot,
    });
  }
  return out;
}

function portAt(p: Point2D, tangent: Point2D) {
  return { point: { ...p }, tangent: { ...tangent } };
}

function cleanLine(pts: Point2D[], minSeg = 1.2): Point2D[] {
  if (pts.length < 2) return [];
  const out: Point2D[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) >= minSeg) out.push({ ...pts[i] });
  }
  return out.length >= 2 ? out : [];
}

function layoutDriveways(
  zoneId: string, poly: Point2D[], form: ZoneBuildForm, setbackM: number, seed: number
): ZoneDriveway[] {
  if (form === 'open' || poly.length < 3) return [];
  const area = Math.abs(signedArea(poly));
  if (area < 120) return [];
  const centroid = polyCentroid(poly);
  const halfW = DRIVE_HALF_W;
  const edgeInset = Math.max(setbackM, 2) + halfW + 0.5;
  let bestLen = 0, entryA = poly[0], entryB = poly[1 % poly.length];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) { bestLen = len; entryA = a; entryB = b; }
  }
  const edgeMid = { x: (entryA.x + entryB.x) / 2, y: (entryA.y + entryB.y) / 2 };
  const edgeU = unit(entryB.x - entryA.x, entryB.y - entryA.y);
  let nx = -edgeU.y, ny = edgeU.x;
  if (nx * (centroid.x - edgeMid.x) + ny * (centroid.y - edgeMid.y) < 0) { nx = -nx; ny = -ny; }
  const portPt = { x: edgeMid.x, y: edgeMid.y };
  const entry = { x: edgeMid.x + nx * edgeInset, y: edgeMid.y + ny * edgeInset };
  if (!pointInPoly(entry, poly)) return [];
  const { ux, uy, len: longLen } = principalAxis(poly);
  const px = -uy, py = ux;
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
      out.push({ id: idBase, zoneId, centerline: pts, halfWidthM: halfW, kind: 'fire',
        ports: [portAt(pts[0], { x: -tanIn.x, y: -tanIn.y })] });
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
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const tan1 = unit(last.x - prev.x, last.y - prev.y);
      out.push({ id: idBase, zoneId, centerline: pts, halfWidthM: halfW, kind: 'access',
        ports: [portAt(pts[0], { x: -tan0.x, y: -tan0.y }), portAt(last, tan1)] });
    }
    return out;
  }
  if (form === 'block') {
    const depth = Math.min(longLen * 0.32, char * 0.26, 32);
    const halfSpan = Math.min(longLen * 0.28, char * 0.22, 26);
    const near = { x: edgeMid.x + nx * (edgeInset + Math.min(6, depth * 0.25)),
      y: edgeMid.y + ny * (edgeInset + Math.min(6, depth * 0.25)) };
    const far = { x: edgeMid.x + nx * (edgeInset + depth), y: edgeMid.y + ny * (edgeInset + depth) };
    const nearL = { x: near.x - edgeU.x * halfSpan, y: near.y - edgeU.y * halfSpan };
    const nearR = { x: near.x + edgeU.x * halfSpan, y: near.y + edgeU.y * halfSpan };
    const farL = { x: far.x - edgeU.x * halfSpan, y: far.y - edgeU.y * halfSpan };
    const farR = { x: far.x + edgeU.x * halfSpan, y: far.y + edgeU.y * halfSpan };
    let pts = cleanLine(filterCenterlineInside([portPt, entry, near, nearL, farL, farR, nearR, near], poly), 1.5);
    if (pts.length < 3) pts = cleanLine(filterCenterlineInside([portPt, entry, nearL, farL, farR, nearR], poly), 1.5);
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([portPt, entry, far], poly));
    if (pts.length >= 2) {
      const tan0 = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      out.push({ id: idBase, zoneId, centerline: pts, halfWidthM: halfW, kind: 'fire',
        ports: [portAt(pts[0], { x: -tan0.x, y: -tan0.y })] });
    }
    return out;
  }
  {
    const stop = { x: centroid.x * 0.55 + entry.x * 0.45, y: centroid.y * 0.55 + entry.y * 0.45 };
    let pts = cleanLine(filterCenterlineInside([portPt, entry, stop], poly));
    if (pts.length < 2) pts = cleanLine(filterCenterlineInside([entry, centroid], poly));
    if (pts.length >= 2) {
      const tanIn = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      out.push({ id: `${idBase}-a`, zoneId, centerline: pts, halfWidthM: halfW, kind: 'access',
        ports: [portAt(pts[0], { x: -tanIn.x, y: -tanIn.y })] });
    }
  }
  return out;
}

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
    const dx = p.x - c.x, dy = p.y - c.y;
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

function scatterTrees(poly: Point2D[], seed: number, densityPerHa: number, minSpacingM: number) {
  const area = Math.abs(signedArea(poly));
  if (area < 30) return [] as { x: number; y: number }[];
  const target = Math.max(1, Math.round((area / 10_000) * densityPerHa));
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const trees: { x: number; y: number }[] = [];
  let attempts = 0;
  while (trees.length < target && attempts < target * 40) {
    attempts++;
    const x = minX + rng() * (maxX - minX), y = minY + rng() * (maxY - minY);
    if (!pointInPoly({ x, y }, poly)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < minSpacingM)) continue;
    trees.push({ x, y });
  }
  return trees;
}

function layoutCourtyards(
  zoneId: string, poly: Point2D[], form: ZoneBuildForm, setbackM: number, seed: number, _driveways: ZoneDriveway[]
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
    if (inner) out.push({ id: idBase, zoneId, polygon: inner, kind: 'court', trees: scatterTrees(inner, seed, 45, 6) });
    return out;
  }
  if (form === 'tower') {
    const plaza = shrinkPolyTowardCentroid(poly, edgePad + 6);
    if (plaza) out.push({
      id: idBase, zoneId, polygon: plaza, kind: 'plaza',
      trees: scatterTrees(plaza, seed, 25, 8).filter((t) => Math.hypot(t.x - centroid.x, t.y - centroid.y) > 8),
    });
    return out;
  }
  if (form === 'corridor') {
    const { ux, uy, len: longLen } = principalAxis(poly);
    const px = -uy, py = ux;
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
      out.push({ id: idBase, zoneId, polygon: corners, kind: 'green', trees: scatterTrees(corners, seed, 35, 6) });
    }
    return out;
  }
  if (form === 'open') {
    const green = shrinkPolyTowardCentroid(poly, edgePad);
    if (green) out.push({ id: idBase, zoneId, polygon: green, kind: 'green', trees: scatterTrees(green, seed, 60, 5) });
    return out;
  }
  const patch = shrinkPolyTowardCentroid(poly, edgePad + 8);
  if (patch) out.push({ id: idBase, zoneId, polygon: patch, kind: 'green', trees: scatterTrees(patch, seed, 30, 7) });
  return out;
}

function isNearlyRect(poly: Point2D[]): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) return false;
  }
  return true;
}

function parcelizePerimeterAlongEdges(
  poly: Point2D[], setbackM: number, parcelDepthM: number, coverage: number, minW: number, minD: number
): ParcelCell[] {
  if (poly.length < 3) return [];
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const ccw = signedArea(poly) > 0;
  const centroid = polyCentroid(poly);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const charSize = Math.min(maxX - minX, maxY - minY);
  if (charSize < 10) return [];
  let depth = Math.min(parcelDepthM, charSize * 0.28, Math.max(minD, 10));
  depth = Math.max(MIN_BLDG_SIDE, Math.min(depth, 22));
  let perimeter = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const ringApprox = perimeter * depth;
  const covScale = Math.min(1, Math.max(0.55, (coverage * area) / Math.max(1, ringApprox)));
  depth = Math.max(MIN_BLDG_SIDE, depth * Math.sqrt(covScale));
  const insetDist = setbackM + depth / 2 + 0.3;
  const cornerCut = depth * 0.65 + setbackM * 0.25;
  const cells: ParcelCell[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < minW * 0.6) continue;
    const ux = dx / edgeLen, uy = dy / edgeLen;
    let nx = ccw ? -uy : uy, ny = ccw ? ux : -ux;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const toC = { x: centroid.x - mid.x, y: centroid.y - mid.y };
    if (nx * toC.x + ny * toC.y < 0) { nx = -nx; ny = -ny; }
    const usable = edgeLen - 2 * cornerCut;
    if (usable < minW * 0.5) continue;
    cells.push({ cx: mid.x + nx * insetDist, cy: mid.y + ny * insetDist, w: usable, d: depth, parcelArea: area / n, rot: Math.atan2(uy, ux) });
  }
  return cells;
}

function parcelizePerimeterRect(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number, coverage: number, minD: number
): ParcelCell[] {
  const W = box.maxX - box.minX, D = box.maxY - box.minY, area = Math.max(1, W * D);
  if (W < 8 || D < 8) return [];
  let depth = Math.min(Math.max(parcelDepthM, minD), Math.min(W, D) * 0.32);
  depth = Math.max(MIN_BLDG_SIDE, Math.min(depth, Math.min(W, D) * 0.38 - 1, 22));
  if (W < depth * 2 + 6 || D < depth * 2 + 6) {
    return [{ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w: W * 0.85, d: D * 0.85, parcelArea: area }];
  }
  const pad = 0.2;
  const x0 = box.minX + pad, x1 = box.maxX - pad, y0 = box.minY + pad, y1 = box.maxY - pad;
  const iW = x1 - x0, iD = y1 - y0;
  const ringArea = 2 * (iW + iD) * depth - 4 * depth * depth;
  const scale = Math.min(1, Math.max(0.5, (coverage * area) / Math.max(1, ringArea)));
  let dUse = Math.max(MIN_BLDG_SIDE, Math.min(depth * Math.sqrt(scale), Math.min(iW, iD) * 0.38));
  const cells: ParcelCell[] = [], share = area / 4;
  cells.push({ cx: (x0 + x1) / 2, cy: y0 + dUse / 2, w: iW, d: dUse, parcelArea: share });
  cells.push({ cx: (x0 + x1) / 2, cy: y1 - dUse / 2, w: iW, d: dUse, parcelArea: share });
  const gap = iD - 2 * dUse;
  if (gap >= MIN_BLDG_SIDE) {
    cells.push({ cx: x0 + dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: gap, parcelArea: share });
    cells.push({ cx: x1 - dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: gap, parcelArea: share });
  }
  return cells;
}

function parcelizeTower(
  poly: Point2D[], coverage: number, minW: number, setbackM: number, rng: () => number
): ParcelCell[] {
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const centroid = polyCentroid(poly);
  const jitter = Math.min(3, Math.sqrt(area) * 0.02);
  const cx = centroid.x + (rng() - 0.5) * jitter;
  const cy = centroid.y + (rng() - 0.5) * jitter;
  const targetFp = area * Math.min(0.15, Math.max(0.04, coverage * 0.4));
  let side = Math.max(minW * 0.85, Math.sqrt(targetFp));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const char = Math.min(maxX - minX, maxY - minY) - 2 * Math.max(0, setbackM);
  side = Math.min(side, Math.max(minW * 0.7, char * 0.35), 36);
  const aspect = 0.75 + rng() * 0.35;
  let w = side, d = side * aspect;
  const rot = (rng() - 0.5) * ((12 * Math.PI) / 180);
  for (let step = 0; step < 14; step++) {
    if (footprintMostlyInside(rectFootprint(cx, cy, w, d, rot), poly))
      return [{ cx, cy, w, d, parcelArea: area, rot }];
    w *= 0.9; d *= 0.9;
    if (w < minW * 0.5 || d < minW * 0.5) break;
  }
  const s = Math.max(8, minW * 0.55);
  if (footprintMostlyInside(rectFootprint(centroid.x, centroid.y, s, s, 0), poly))
    return [{ cx: centroid.x, cy: centroid.y, w: s, d: s, parcelArea: area, rot: 0 }];
  return [];
}

function parcelizeRandom(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  poly: Point2D[], coverage: number, minW: number, minD: number, rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX, D = box.maxY - box.minY, area = W * D;
  const avgFp = Math.max(minW * minD, 120);
  const targetCount = Math.max(1, Math.round((area * coverage) / avgFp));
  const cells: ParcelCell[] = [];
  const placed: { box: ReturnType<typeof aabbOf> }[] = [];
  let attempts = 0;
  while (cells.length < targetCount && attempts < targetCount * 50) {
    attempts++;
    const side = Math.max(minW, minD) * (1 + rng() * 0.55);
    const aspect = 0.7 + rng() * 0.7;
    const w = side, d = side * aspect;
    const margin = Math.max(w, d) * 0.55;
    const cx = box.minX + margin + rng() * Math.max(0.1, W - margin * 2);
    const cy = box.minY + margin + rng() * Math.max(0.1, D - margin * 2);
    const rot = (rng() - 0.5) * ((20 * Math.PI) / 180);
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (!footprintMostlyInside(fp, poly)) continue;
    const bb = aabbOf(fp);
    if (placed.some((p) => aabbOverlap(bb, p.box, BLDG_GAP_M))) continue;
    placed.push({ box: bb });
    cells.push({ cx, cy, w, d, parcelArea: area / targetCount, rot });
  }
  return cells;
}

function parcelizeCorridor(
  poly: Point2D[], box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number, coverage: number, minW: number, setbackM: number
): ParcelCell[] {
  const area = Math.abs(signedArea(poly));
  if (area < 20) return [];
  const centroid = polyCentroid(poly);
  const { ux, uy, len: longLen } = principalAxis(poly);
  const nx = -uy, ny = ux, rot = Math.atan2(uy, ux);
  let tMin = Infinity, tMax = -Infinity, nMin = Infinity, nMax = -Infinity;
  for (const p of poly) {
    const t = (p.x - centroid.x) * ux + (p.y - centroid.y) * uy;
    const n = (p.x - centroid.x) * nx + (p.y - centroid.y) * ny;
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    nMin = Math.min(nMin, n); nMax = Math.max(nMax, n);
  }
  const axisSpan = tMax - tMin, normalSpan = nMax - nMin;
  if (axisSpan < 8 || normalSpan < 4) return [];
  const pad = Math.max(0.4, setbackM * 0.5);
  const maxLen = Math.max(minW, axisSpan - 2 * pad);
  const maxDepth = Math.max(4, normalSpan - 2 * pad);
  const targetDepth = Math.min(parcelDepthM, normalSpan * 0.55, Math.max(minW, 8));

  function trySingle(len: number, depth: number): ParcelCell | null {
    let L = len, D = depth;
    for (let step = 0; step < 12; step++) {
      if (footprintMostlyInside(rectFootprint(centroid.x, centroid.y, L, D, rot), poly))
        return { cx: centroid.x, cy: centroid.y, w: L, d: D, parcelArea: area, rot };
      L *= 0.92; D *= 0.94;
      if (L < minW * 0.6 || D < 3) break;
    }
    return null;
  }
  function tryDouble(len: number, depth: number): ParcelCell[] {
    const gap = Math.max(BLDG_GAP_M, Math.min(depth * 0.8, normalSpan * 0.2));
    const halfOff = (depth + gap) / 2;
    if (halfOff * 2 + depth > normalSpan - pad) return [];
    const cells: ParcelCell[] = [];
    for (const sign of [-1, 1]) {
      let L = len, D = depth;
      const ox = centroid.x + nx * halfOff * sign, oy = centroid.y + ny * halfOff * sign;
      for (let step = 0; step < 12; step++) {
        if (footprintMostlyInside(rectFootprint(ox, oy, L, D, rot), poly)) {
          cells.push({ cx: ox, cy: oy, w: L, d: D, parcelArea: area / 2, rot });
          break;
        }
        L *= 0.92; D *= 0.94;
        if (L < minW * 0.5 || D < 3) break;
      }
    }
    return cells;
  }
  let depth = Math.min(targetDepth * Math.sqrt(Math.max(0.4, coverage)), maxDepth * 0.7);
  depth = Math.max(MIN_BLDG_SIDE, depth);
  let len = Math.min(maxLen * 0.95, longLen * 0.85);
  const single = trySingle(len, depth);
  if (single) {
    if (coverage > 0.35 && single.w * single.d < area * coverage * 0.7 && normalSpan > depth * 3) {
      const dbl = tryDouble(len * 0.9, depth * 0.55);
      if (dbl.length >= 2) return dbl;
    }
    return [single];
  }
  const dbl = tryDouble(len * 0.85, depth * 0.5);
  if (dbl.length >= 1) return dbl;
  const fallback = trySingle(Math.min(maxLen * 0.6, minW * 2), Math.min(maxDepth * 0.5, minW));
  return fallback ? [fallback] : [];
}

export interface GenerateOptions {
  roads?: { points: Point2D[]; halfWidthM: number }[];
}

export function generateZoneContent(zone: ZoneRect, opts: GenerateOptions = {}): ZoneGeneratedContent {
  const empty: ZoneGeneratedContent = { buildings: [], driveways: [], courtyards: [] };
  if (zone.type === 'boundary' || zone.type === 'park') return empty;
  const params = resolveZoneParams(zone);
  if (params.buildForm === 'open' || params.coverage <= 0 || params.far <= 0) return empty;

  const poly = zonePolygon(zone);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
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
      if (inset) cells = parcelizeRandom(inset, poly, params.coverage, min.w, min.d, rng);
      break;
    case 'corridor': {
      const boxForCorridor = inset ?? { minX, maxX, minY, maxY };
      cells = parcelizeCorridor(poly, boxForCorridor, params.parcelDepthM, params.coverage, min.w, setback);
      break;
    }
    case 'block':
    default: {
      if (isNearlyRect(poly) && inset) cells = parcelizePerimeterRect(inset, params.parcelDepthM, params.coverage, min.d);
      else cells = parcelizePerimeterAlongEdges(poly, setback, params.parcelDepthM, params.coverage, min.w, min.d);
      if (!cells.length && inset) cells = parcelizePerimeterRect(inset, params.parcelDepthM, params.coverage, min.d);
      break;
    }
  }

  const expanded: ParcelCell[] = [];
  for (const cell of cells) for (const s of segmentLongCell(cell, Math.max(MIN_BLDG_SIDE, min.w * 0.75))) expanded.push(s);

  const zoneArea = Math.abs(signedArea(poly));
  const buildings: GeneratedBuilding[] = [];
  const acceptedFp: Point2D[][] = [];

  for (let i = 0; i < expanded.length; i++) {
    const cell = expanded[i];
    const rot = cell.rot ?? 0;
    let { w, d } = normalizeCellDims(cell.w, cell.d, Math.max(MIN_BLDG_SIDE, min.w * 0.7));
    let fp = rectFootprint(cell.cx, cell.cy, w, d, rot);
    let ok = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (footprintFullyInside(fp, poly) && !footprintHitsDriveway(fp, driveways) && !footprintHitsCourtyard(fp, courtyards)) {
        if (!acceptedFp.some((other) => polysOverlap(fp, other, BLDG_GAP_M))) { ok = true; break; }
      }
      w *= 0.88; d *= 0.88;
      if (w < MIN_BLDG_SIDE * 0.9 || d < MIN_BLDG_SIDE * 0.9) break;
      fp = rectFootprint(cell.cx, cell.cy, w, d, rot);
    }
    if (!ok) continue;
    const fpA = footprintArea(fp);
    if (fpA < 35) continue;
    acceptedFp.push(fp);

    const share = cell.parcelArea > 0 ? cell.parcelArea : zoneArea / Math.max(1, expanded.length);
    let { heightM, floors } = heightFromFar(params.far, share, fpA, params.maxFloors, FLOOR_HEIGHT_M);
    if (params.buildForm === 'random') {
      floors = Math.max(1, Math.min(params.maxFloors, Math.round(floors * (0.65 + rng() * 0.7))));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    if (params.buildForm === 'tower') {
      floors = Math.max(floors, Math.min(params.maxFloors, Math.max(8, Math.round(params.maxFloors * 0.85))));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    buildings.push({
      id: uid(zone.id, i, params.seed), zoneId: zone.id, footprint: fp,
      heightM, floors, type: zone.type, buildForm: params.buildForm,
    });
  }

  if (buildings.length && params.far > 0 && zoneArea > 1) {
    let gfa = 0;
    for (const b of buildings) gfa += footprintArea(b.footprint) * b.floors;
    const targetGfa = params.far * zoneArea;
    if (gfa < targetGfa * 0.85 && gfa > 0) {
      const minF = Math.min(...buildings.map((b) => b.floors));
      const scale = Math.min(params.maxFloors / Math.max(1, minF), targetGfa / gfa);
      if (scale > 1.05) {
        for (const b of buildings) {
          const nf = Math.min(params.maxFloors, Math.max(b.floors, Math.round(b.floors * scale)));
          b.floors = nf; b.heightM = nf * FLOOR_HEIGHT_M;
        }
      }
    }
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
