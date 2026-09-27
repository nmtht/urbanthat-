/**
 * Zone → GeneratedBuilding[] pipeline (Sprint 4).
 * Buildings must stay inside the zone polygon, never overlap.
 * block = perimeter courtyard along boundary.
 */

import type { Point2D } from '../domain/SceneOrigin';
import type {
  GeneratedBuilding,
  ZoneBuildForm,
  ZoneRect,
  ZoneType,
} from '../domain/zones';
import {
  FLOOR_HEIGHT_M,
  resolveZoneParams,
  zoneAreaM2,
  zonePolygon,
} from '../domain/zones';

const MIN_FOOTPRINT: Record<string, { w: number; d: number }> = {
  residential: { w: 8, d: 8 },
  commercial: { w: 12, d: 12 },
  industrial: { w: 16, d: 12 },
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
  const hw = w / 2;
  const hd = d / 2;
  const corners: Point2D[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  if (Math.abs(rot) < 1e-6) {
    return corners.map((p) => ({ x: p.x + cx, y: p.y + cy }));
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return corners.map((p) => ({
    x: p.x * c - p.y * s + cx,
    y: p.x * s + p.y * c + cy,
  }));
}

function footprintArea(fp: Point2D[]): number {
  let a = 0;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
    a += fp[j].x * fp[i].y - fp[i].x * fp[j].y;
  }
  return Math.abs(a) * 0.5;
}

function pointInPoly(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True if every corner (and center) of the footprint is inside the polygon. */
function footprintInside(fp: Point2D[], poly: Point2D[]): boolean {
  for (const p of fp) {
    if (!pointInPoly(p, poly)) return false;
  }
  let cx = 0,
    cy = 0;
  for (const p of fp) {
    cx += p.x;
    cy += p.y;
  }
  cx /= fp.length;
  cy /= fp.length;
  return pointInPoly({ x: cx, y: cy }, poly);
}

function aabbOverlap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
  pad = 1.5
): boolean {
  return !(
    a.maxX + pad < b.minX ||
    a.minX - pad > b.maxX ||
    a.maxY + pad < b.minY ||
    a.minY - pad > b.maxY
  );
}

function fpAabb(fp: Point2D[]) {
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

function uid(prefix: string, i: number, seed: number): string {
  return `${prefix}-${(seed ^ (i * 2654435761)) >>> 0}`;
}

function heightFromFar(
  far: number,
  parcelArea: number,
  fpArea: number,
  maxFloors: number,
  floorH: number
): { heightM: number; floors: number } {
  if (fpArea < 1 || far <= 0) return { heightM: floorH, floors: 1 };
  const targetGfa = far * parcelArea;
  let floors = Math.max(1, Math.round(targetGfa / fpArea));
  floors = Math.min(floors, Math.max(1, maxFloors));
  return { heightM: floors * floorH, floors };
}

interface Cell {
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot: number;
  parcelArea: number;
}

function polyBBox(poly: Point2D[]) {
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
  return { minX, maxX, minY, maxY };
}

/** Perimeter (block): buildings along each edge, depth toward interior → courtyard. */
function parcelizePerimeter(
  poly: Point2D[],
  parcelDepthM: number,
  coverage: number,
  minW: number,
  minD: number,
  zoneArea: number
): Cell[] {
  const cells: Cell[] = [];
  const depth = Math.max(minD, Math.min(parcelDepthM, 18));
  const frontW = Math.max(minW, Math.min(20, 14));
  const n = poly.length;

  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < frontW * 0.8) continue;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let nx = cx - mx;
    let ny = cy - my;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;

    const count = Math.max(1, Math.floor(len / frontW));
    const unit = len / count;
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const ex = a.x + (b.x - a.x) * t;
      const ey = a.y + (b.y - a.y) * t;
      const inset = 1.5 + depth / 2;
      const px = ex + nx * inset;
      const py = ey + ny * inset;
      const w = Math.max(minW, unit * 0.88 * Math.sqrt(Math.min(1, coverage / 0.4)));
      const d = Math.max(minD, depth * 0.9);
      const rot = Math.atan2(ty, tx);
      cells.push({
        cx: px,
        cy: py,
        w,
        d,
        rot,
        parcelArea: unit * depth,
      });
    }
  }

  const maxByCov = Math.max(1, Math.round((zoneArea * coverage) / (frontW * depth * 0.7)));
  if (cells.length > maxByCov) return cells.slice(0, maxByCov);
  return cells;
}

/** Tower: single building, small footprint, max height from FAR. */
function parcelizeTower(
  poly: Point2D[],
  coverage: number,
  minW: number,
  zoneArea: number
): Cell[] {
  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  if (!pointInPoly({ x: cx, y: cy }, poly)) {
    const bb = polyBBox(poly);
    cx = (bb.minX + bb.maxX) / 2;
    cy = (bb.minY + bb.maxY) / 2;
  }
  const targetFp = Math.max(minW * minW, zoneArea * Math.min(0.15, Math.max(0.05, coverage)));
  const side = Math.max(minW, Math.sqrt(targetFp));
  return [
    {
      cx,
      cy,
      w: side,
      d: side * 0.85,
      rot: 0,
      parcelArea: zoneArea,
    },
  ];
}

/** Random non-overlapping placement with random rotation, strictly inside poly. */
function parcelizeRandom(
  poly: Point2D[],
  coverage: number,
  minW: number,
  minD: number,
  zoneArea: number,
  rng: () => number
): Cell[] {
  const bb = polyBBox(poly);
  const W = bb.maxX - bb.minX;
  const D = bb.maxY - bb.minY;
  const avgFp = Math.max(minW * minD, 100);
  const targetCount = Math.max(1, Math.min(40, Math.round((zoneArea * coverage) / avgFp)));
  const cells: Cell[] = [];
  const placed: { aabb: ReturnType<typeof fpAabb> }[] = [];
  let attempts = 0;
  const maxAttempts = targetCount * 80;

  while (cells.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const w = minW * (0.9 + rng() * 0.7);
    const d = minD * (0.9 + rng() * 0.7);
    const rot = (rng() - 0.5) * Math.PI;
    const margin = Math.hypot(w, d) * 0.55;
    const cx = bb.minX + margin + rng() * Math.max(0.1, W - margin * 2);
    const cy = bb.minY + margin + rng() * Math.max(0.1, D - margin * 2);
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (!footprintInside(fp, poly)) continue;
    const aabb = fpAabb(fp);
    let ok = true;
    for (const p of placed) {
      if (aabbOverlap(aabb, p.aabb, 2)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    placed.push({ aabb });
    cells.push({ cx, cy, w, d, rot, parcelArea: zoneArea / targetCount });
  }
  return cells;
}

function parcelizeCorridor(
  poly: Point2D[],
  parcelDepthM: number,
  coverage: number,
  minW: number,
  zoneArea: number
): Cell[] {
  const bb = polyBBox(poly);
  const W = bb.maxX - bb.minX;
  const D = bb.maxY - bb.minY;
  const alongX = W >= D;
  const depth = Math.min(parcelDepthM, (alongX ? D : W) * 0.55);
  const strip = Math.max(minW, depth * Math.sqrt(Math.max(0.2, coverage)));
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  if (alongX) {
    return [
      {
        cx,
        cy,
        w: Math.min(W * 0.85, W - 4),
        d: strip,
        rot: 0,
        parcelArea: zoneArea,
      },
    ];
  }
  return [
    {
      cx,
      cy,
      w: strip,
      d: Math.min(D * 0.85, D - 4),
      rot: 0,
      parcelArea: zoneArea,
    },
  ];
}

export interface GenerateOptions {
  roads?: { points: Point2D[]; halfWidthM: number }[];
}

export function generateBuildingsForZone(
  zone: ZoneRect,
  _opts: GenerateOptions = {}
): GeneratedBuilding[] {
  if (zone.type === 'boundary' || zone.type === 'park') return [];

  const params = resolveZoneParams(zone);
  if (params.buildForm === 'open' || params.coverage <= 0 || params.far <= 0) {
    return [];
  }

  const poly = zonePolygon(zone);
  if (poly.length < 3) return [];

  const setback = Math.max(0, params.setbackM);
  const zoneArea = zoneAreaM2(zone);
  const rng = mulberry32(params.seed);
  const min = MIN_FOOTPRINT[zone.type] ?? MIN_FOOTPRINT.residential;

  let cells: Cell[] = [];
  switch (params.buildForm) {
    case 'tower':
      cells = parcelizeTower(poly, params.coverage, min.w, zoneArea);
      break;
    case 'random':
      cells = parcelizeRandom(poly, params.coverage, min.w, min.d, zoneArea, rng);
      break;
    case 'corridor':
      cells = parcelizeCorridor(poly, params.parcelDepthM, params.coverage, min.w, zoneArea);
      break;
    case 'block':
    default:
      cells = parcelizePerimeter(
        poly,
        params.parcelDepthM,
        params.coverage,
        min.w,
        min.d,
        zoneArea
      );
      break;
  }

  const out: GeneratedBuilding[] = [];
  const accepted: { aabb: ReturnType<typeof fpAabb> }[] = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    let { cx, cy, w, d, rot } = cell;

    let fp = rectFootprint(cx, cy, w, d, rot);
    let tries = 0;
    while (!footprintInside(fp, poly) && tries < 6) {
      w *= 0.85;
      d *= 0.85;
      if (w < min.w * 0.6 || d < min.d * 0.6) break;
      fp = rectFootprint(cx, cy, w, d, rot);
      tries++;
    }
    if (!footprintInside(fp, poly)) continue;

    const aabb = fpAabb(fp);
    void setback;

    let overlaps = false;
    for (const a of accepted) {
      if (aabbOverlap(aabb, a.aabb, 1.5)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const fpA = footprintArea(fp);
    if (fpA < min.w * min.d * 0.35) continue;

    const { heightM, floors } = heightFromFar(
      params.far,
      cell.parcelArea,
      fpA,
      params.maxFloors,
      FLOOR_HEIGHT_M
    );

    let h = heightM;
    let fl = floors;
    if (params.buildForm === 'tower') {
      fl = Math.max(
        floors,
        Math.min(params.maxFloors, Math.max(1, Math.round((params.far * zoneArea) / fpA)))
      );
      fl = Math.min(fl, params.maxFloors);
      h = fl * FLOOR_HEIGHT_M;
    }

    accepted.push({ aabb });
    out.push({
      id: uid(zone.id, i, params.seed),
      zoneId: zone.id,
      footprint: fp,
      heightM: h,
      floors: fl,
      type: zone.type,
      buildForm: params.buildForm,
    });
  }

  return out;
}

export function actualFar(buildings: GeneratedBuilding[], zone: ZoneRect): number {
  const area = zoneAreaM2(zone);
  if (area < 1) return 0;
  let gfa = 0;
  for (const b of buildings) {
    gfa += footprintArea(b.footprint) * b.floors;
  }
  return gfa / area;
}

export function styleFromZoneType(
  t: ZoneType
): 'residential' | 'office' | 'industrial' | 'generic' {
  if (t === 'residential') return 'residential';
  if (t === 'commercial') return 'office';
  if (t === 'industrial') return 'industrial';
  return 'generic';
}

export type { ZoneBuildForm };
