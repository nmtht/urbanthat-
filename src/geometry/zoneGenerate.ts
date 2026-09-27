/**
 * Zone → GeneratedBuilding[] pipeline (Sprint 4).
 * Perimeter = continuous courtyard ring (4 bars along all edges);
 * tower = minimal footprint; random = non-overlapping + random height/rotation;
 * corridor; open.
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
  industrial: { w: 20, d: 15 },
  park: { w: 0, d: 0 },
  boundary: { w: 0, d: 0 },
};

/** Mulberry32 — deterministic PRNG from seed. */
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

function pointInPoly(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y;
    const yj = poly[j].y;
    const xi = poly[i].x;
    const xj = poly[j].x;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Majority of footprint samples must lie inside the zone polygon. */
function footprintInside(fp: Point2D[], poly: Point2D[]): boolean {
  if (fp.length < 3) return false;
  let inside = 0;
  for (const p of fp) {
    if (pointInPoly(p, poly)) inside++;
  }
  let cx = 0, cy = 0;
  for (const p of fp) { cx += p.x; cy += p.y; }
  cx /= fp.length; cy /= fp.length;
  if (pointInPoly({ x: cx, y: cy }, poly)) inside++;
  return inside >= Math.ceil((fp.length + 1) * 0.6);
}

function aabbOf(fp: Point2D[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of fp) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function aabbOverlap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
  gap = 0.5
): boolean {
  return !(
    a.maxX + gap < b.minX || b.maxX + gap < a.minX ||
    a.maxY + gap < b.minY || b.maxY + gap < a.minY
  );
}

function insetBBox(
  minX: number, maxX: number, minY: number, maxY: number, setback: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const nx = minX + setback, xx = maxX - setback, ny = minY + setback, xy = maxY - setback;
  if (xx - nx < 6 || xy - ny < 6) return null;
  return { minX: nx, maxX: xx, minY: ny, maxY: xy };
}

function uid(prefix: string, i: number, seed: number): string {
  return `${prefix}-${(seed ^ (i * 2654435761)) >>> 0}`;
}

function heightFromFar(
  far: number, parcelArea: number, fpArea: number, maxFloors: number, floorH: number
): { heightM: number; floors: number } {
  if (fpArea < 1 || far <= 0) return { heightM: floorH, floors: 1 };
  const targetGfa = far * parcelArea;
  let floors = Math.max(1, Math.round(targetGfa / fpArea));
  floors = Math.min(floors, Math.max(1, maxFloors));
  return { heightM: floors * floorH, floors };
}

interface ParcelCell {
  cx: number; cy: number; w: number; d: number; parcelArea: number; rot?: number;
}

/** Continuous perimeter ring along ALL four edges. */
function parcelizePerimeter(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number, coverage: number, minW: number, minD: number
): ParcelCell[] {
  const W = box.maxX - box.minX, D = box.maxY - box.minY, area = W * D;
  if (W < 10 || D < 10) return [];
  const maxDepthForSides = Math.max(minD * 0.85, (Math.min(W, D) - Math.max(minW, 6)) / 2);
  let depth = Math.min(parcelDepthM, Math.min(W, D) * 0.32, maxDepthForSides);
  depth = Math.max(minD * 0.7, depth);
  if (W < depth * 2 + 5 || D < depth * 2 + 5) {
    return [{ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w: W * 0.94, d: D * 0.94, parcelArea: area }];
  }
  const pad = 0.25;
  const x0 = box.minX + pad, x1 = box.maxX - pad, y0 = box.minY + pad, y1 = box.maxY - pad;
  const innerW = x1 - x0, innerD = y1 - y0;
  const ringAreaApprox = 2 * (innerW + innerD) * depth - 4 * depth * depth;
  const covScale = Math.min(1.2, Math.max(0.5, (coverage * area) / Math.max(1, ringAreaApprox)));
  let dUse = Math.max(minD * 0.75, Math.min(depth, depth * Math.sqrt(covScale)));
  const maxD2 = (Math.min(innerW, innerD) - Math.max(minW, 6)) / 2;
  dUse = Math.min(dUse, Math.max(minD * 0.7, maxD2));
  const cells: ParcelCell[] = [];
  cells.push({ cx: (x0 + x1) / 2, cy: y0 + dUse / 2, w: innerW, d: dUse, parcelArea: area / 4 });
  cells.push({ cx: (x0 + x1) / 2, cy: y1 - dUse / 2, w: innerW, d: dUse, parcelArea: area / 4 });
  const sideLen = Math.max(minW * 0.85, innerD - 2 * dUse);
  cells.push({ cx: x0 + dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: sideLen, parcelArea: area / 4 });
  cells.push({ cx: x1 - dUse / 2, cy: (y0 + y1) / 2, w: dUse, d: sideLen, parcelArea: area / 4 });
  return cells;
}

function parcelizeTower(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  coverage: number, minW: number, rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX, D = box.maxY - box.minY, area = W * D;
  const targetFp = area * Math.min(0.18, coverage * 0.35);
  const side = Math.max(minW, Math.sqrt(targetFp));
  const s = side * (0.9 + rng() * 0.15);
  return [{
    cx: (box.minX + box.maxX) / 2 + (rng() - 0.5) * 2,
    cy: (box.minY + box.maxY) / 2 + (rng() - 0.5) * 2,
    w: s, d: s * (0.75 + rng() * 0.35), parcelArea: area,
  }];
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
    const w = minW * (1 + rng() * 0.9), d = minD * (1 + rng() * 0.9);
    const margin = Math.max(w, d) * 0.55;
    const cx = box.minX + margin + rng() * Math.max(0.1, W - margin * 2);
    const cy = box.minY + margin + rng() * Math.max(0.1, D - margin * 2);
    const rot = (rng() - 0.5) * ((20 * Math.PI) / 180);
    const fp = rectFootprint(cx, cy, w, d, rot);
    if (!footprintInside(fp, poly)) continue;
    const bb = aabbOf(fp);
    let ok = true;
    for (const p of placed) { if (aabbOverlap(bb, p.box, 2)) { ok = false; break; } }
    if (!ok) continue;
    placed.push({ box: bb });
    cells.push({ cx, cy, w, d, parcelArea: area / targetCount, rot });
  }
  return cells;
}

function parcelizeCorridor(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number, coverage: number, minW: number
): ParcelCell[] {
  const W = box.maxX - box.minX, D = box.maxY - box.minY;
  const alongX = W >= D;
  const depth = Math.min(parcelDepthM, (alongX ? D : W) * 0.7);
  if (alongX) {
    return [{ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w: W * 0.95, d: Math.max(minW, depth * Math.sqrt(coverage)), parcelArea: W * D }];
  }
  return [{ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w: Math.max(minW, depth * Math.sqrt(coverage)), d: D * 0.95, parcelArea: W * D }];
}

export interface GenerateOptions {
  roads?: { points: Point2D[]; halfWidthM: number }[];
}

export function generateBuildingsForZone(
  zone: ZoneRect, _opts: GenerateOptions = {}
): GeneratedBuilding[] {
  if (zone.type === 'boundary' || zone.type === 'park') return [];
  const params = resolveZoneParams(zone);
  if (params.buildForm === 'open' || params.coverage <= 0 || params.far <= 0) return [];
  const poly = zonePolygon(zone);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const inset = insetBBox(minX, maxX, minY, maxY, params.setbackM);
  if (!inset) return [];
  const rng = mulberry32(params.seed);
  const min = MIN_FOOTPRINT[zone.type] ?? MIN_FOOTPRINT.residential;
  let cells: ParcelCell[] = [];
  switch (params.buildForm) {
    case 'tower': cells = parcelizeTower(inset, params.coverage, min.w, rng); break;
    case 'random': cells = parcelizeRandom(inset, poly, params.coverage, min.w, min.d, rng); break;
    case 'corridor': cells = parcelizeCorridor(inset, params.parcelDepthM, params.coverage, min.w); break;
    case 'block':
    default: cells = parcelizePerimeter(inset, params.parcelDepthM, params.coverage, min.w, min.d); break;
  }
  const out: GeneratedBuilding[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const rot = cell.rot ?? 0;
    let fp = rectFootprint(cell.cx, cell.cy, cell.w, cell.d, rot);
    let fpA = footprintArea(fp);
    if (fpA < min.w * min.d * 0.25) continue;
    if (params.buildForm !== 'block' && !footprintInside(fp, poly)) {
      fp = rectFootprint(cell.cx, cell.cy, cell.w * 0.9, cell.d * 0.9, rot);
      fpA = footprintArea(fp);
      if (!footprintInside(fp, poly)) continue;
    }
    let { heightM, floors } = heightFromFar(params.far, cell.parcelArea, fpA, params.maxFloors, FLOOR_HEIGHT_M);
    if (params.buildForm === 'random') {
      const factor = 0.55 + rng() * 0.9;
      floors = Math.max(1, Math.min(params.maxFloors, Math.round(floors * factor)));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    if (params.buildForm === 'tower') {
      floors = Math.max(floors, Math.min(params.maxFloors, Math.max(4, Math.round(params.maxFloors * 0.85))));
      heightM = floors * FLOOR_HEIGHT_M;
    }
    out.push({ id: uid(zone.id, i, params.seed), zoneId: zone.id, footprint: fp, heightM, floors, type: zone.type, buildForm: params.buildForm });
  }
  return out;
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
