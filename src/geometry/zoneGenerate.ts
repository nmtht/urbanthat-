/**
 * Zone → GeneratedBuilding[] pipeline (Sprint 4 MVP).
 * Phase 1: block + open (+ simple tower). Rect zones first; polygon uses bbox.
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

/** Simple AABB inset (setback). For rect zones this is exact; for poly uses bbox. */
function insetBBox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  setback: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const nx = minX + setback;
  const xx = maxX - setback;
  const ny = minY + setback;
  const xy = maxY - setback;
  if (xx - nx < 6 || xy - ny < 6) return null;
  return { minX: nx, maxX: xx, minY: ny, maxY: xy };
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

interface ParcelCell {
  cx: number;
  cy: number;
  w: number;
  d: number;
  parcelArea: number;
}

/** Grid parcels along the longer axis; optional courtyard when zone is large. */
function parcelizeBlock(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number,
  coverage: number,
  minW: number,
  minD: number,
  rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX;
  const D = box.maxY - box.minY;
  const cells: ParcelCell[] = [];

  const alongX = W >= D;
  const depth = Math.min(parcelDepthM, (alongX ? D : W) * 0.45);
  const streetGap = 6;

  const rows: { y0: number; y1: number }[] = [];
  if (alongX) {
    if (D > depth * 2 + streetGap + 4) {
      rows.push({ y0: box.minY, y1: box.minY + depth });
      rows.push({ y0: box.maxY - depth, y1: box.maxY });
    } else {
      rows.push({ y0: box.minY, y1: box.maxY });
    }
  } else {
    if (W > depth * 2 + streetGap + 4) {
      rows.push({ y0: box.minX, y1: box.minX + depth });
      rows.push({ y0: box.maxX - depth, y1: box.maxX });
    } else {
      rows.push({ y0: box.minX, y1: box.maxX });
    }
  }

  const frontLen = alongX ? W : D;
  const unitW = Math.max(minW, Math.min(22, frontLen / Math.max(2, Math.floor(frontLen / 18))));
  const nUnits = Math.max(1, Math.floor(frontLen / unitW));
  const actualUnit = frontLen / nUnits;

  for (const row of rows) {
    const rowDepth = row.y1 - row.y0;
    for (let i = 0; i < nUnits; i++) {
      let cx: number;
      let cy: number;
      let w: number;
      let d: number;
      if (alongX) {
        const x0 = box.minX + i * actualUnit;
        cx = x0 + actualUnit / 2;
        cy = (row.y0 + row.y1) / 2;
        w = actualUnit * 0.92;
        d = rowDepth * 0.9;
      } else {
        const y0 = box.minY + i * actualUnit;
        cx = (row.y0 + row.y1) / 2;
        cy = y0 + actualUnit / 2;
        w = rowDepth * 0.9;
        d = actualUnit * 0.92;
      }
      const scale = Math.sqrt(Math.max(0.15, Math.min(1, coverage / 0.55)));
      w = Math.max(minW, w * scale);
      d = Math.max(minD, d * scale);
      cx += (rng() - 0.5) * 0.8;
      cy += (rng() - 0.5) * 0.8;
      const parcelArea = actualUnit * rowDepth;
      cells.push({ cx, cy, w, d, parcelArea });
    }
  }

  return cells;
}

function parcelizeTower(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  coverage: number,
  minW: number,
  rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX;
  const D = box.maxY - box.minY;
  const area = W * D;
  const targetFp = area * Math.min(0.35, coverage * 0.7);
  const side = Math.max(minW, Math.sqrt(targetFp));
  const n = Math.min(4, Math.max(1, Math.round(area / 4000)));
  const cells: ParcelCell[] = [];
  const cols = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = box.minX + ((col + 0.5) / cols) * W + (rng() - 0.5) * 4;
    const cy = box.minY + ((row + 0.5) / rows) * D + (rng() - 0.5) * 4;
    const s = side * (0.85 + rng() * 0.25);
    cells.push({
      cx,
      cy,
      w: s,
      d: s * (0.7 + rng() * 0.5),
      parcelArea: area / n,
    });
  }
  return cells;
}

function parcelizeRandom(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  coverage: number,
  minW: number,
  minD: number,
  rng: () => number
): ParcelCell[] {
  const W = box.maxX - box.minX;
  const D = box.maxY - box.minY;
  const area = W * D;
  const avgFp = Math.max(minW * minD, 120);
  const targetCount = Math.max(1, Math.round((area * coverage) / avgFp));
  const cells: ParcelCell[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  let attempts = 0;
  while (cells.length < targetCount && attempts < targetCount * 40) {
    attempts++;
    const w = minW * (1 + rng() * 0.8);
    const d = minD * (1 + rng() * 0.8);
    const margin = Math.max(w, d) * 0.55;
    const cx = box.minX + margin + rng() * (W - margin * 2);
    const cy = box.minY + margin + rng() * (D - margin * 2);
    if (cx < box.minX + margin || cx > box.maxX - margin) continue;
    if (cy < box.minY + margin || cy > box.maxY - margin) continue;
    const r = Math.hypot(w, d) * 0.45;
    let ok = true;
    for (const p of placed) {
      if (Math.hypot(p.x - cx, p.y - cy) < p.r + r + 3) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    placed.push({ x: cx, y: cy, r });
    cells.push({ cx, cy, w, d, parcelArea: area / targetCount });
  }
  return cells;
}

function parcelizeCorridor(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  parcelDepthM: number,
  coverage: number,
  minW: number
): ParcelCell[] {
  const W = box.maxX - box.minX;
  const D = box.maxY - box.minY;
  const alongX = W >= D;
  const depth = Math.min(parcelDepthM, (alongX ? D : W) * 0.7);
  const cells: ParcelCell[] = [];
  if (alongX) {
    const cy = (box.minY + box.maxY) / 2;
    const stripD = Math.max(minW, depth * Math.sqrt(coverage));
    cells.push({
      cx: (box.minX + box.maxX) / 2,
      cy,
      w: W * 0.95,
      d: stripD,
      parcelArea: W * D,
    });
  } else {
    const cx = (box.minX + box.maxX) / 2;
    const stripW = Math.max(minW, depth * Math.sqrt(coverage));
    cells.push({
      cx,
      cy: (box.minY + box.maxY) / 2,
      w: stripW,
      d: D * 0.95,
      parcelArea: W * D,
    });
  }
  return cells;
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

  const inset = insetBBox(minX, maxX, minY, maxY, params.setbackM);
  if (!inset) return [];

  const rng = mulberry32(params.seed);
  const min = MIN_FOOTPRINT[zone.type] ?? MIN_FOOTPRINT.residential;

  let cells: ParcelCell[] = [];
  switch (params.buildForm) {
    case 'tower':
      cells = parcelizeTower(inset, params.coverage, min.w, rng);
      break;
    case 'random':
      cells = parcelizeRandom(inset, params.coverage, min.w, min.d, rng);
      break;
    case 'corridor':
      cells = parcelizeCorridor(inset, params.parcelDepthM, params.coverage, min.w);
      break;
    case 'block':
    default:
      cells = parcelizeBlock(
        inset,
        params.parcelDepthM,
        params.coverage,
        min.w,
        min.d,
        rng
      );
      break;
  }

  const out: GeneratedBuilding[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const rot =
      params.buildForm === 'random' ? (rng() - 0.5) * ((15 * Math.PI) / 180) : 0;
    const fp = rectFootprint(cell.cx, cell.cy, cell.w, cell.d, rot);
    const fpA = footprintArea(fp);
    if (fpA < min.w * min.d * 0.5) continue;

    const { heightM, floors } = heightFromFar(
      params.far,
      cell.parcelArea,
      fpA,
      params.maxFloors,
      FLOOR_HEIGHT_M
    );

    out.push({
      id: uid(zone.id, i, params.seed),
      zoneId: zone.id,
      footprint: fp,
      heightM,
      floors,
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

export function styleFromZoneType(t: ZoneType): 'residential' | 'office' | 'industrial' | 'generic' {
  if (t === 'residential') return 'residential';
  if (t === 'commercial') return 'office';
  if (t === 'industrial') return 'industrial';
  return 'generic';
}

export type { ZoneBuildForm };
