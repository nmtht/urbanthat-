/**
 * Zone content pipeline — E0 minimal fix (restore + I5 capacity).
 * Buildings first; courtyards/driveways only if space remains.
 * Full algorithm rewrite tracked in URBANTHAT_TZ_v2.md (E3).
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

const MIN_SIDE = 8;
const BLDG_GAP = 4;
const MAX_BAR = 42;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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

function pointInPoly(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y, yj = poly[j].y, xi = poly[i].x, xj = poly[j].x;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function footprintArea(fp: Point2D[]): number {
  return Math.abs(signedArea(fp));
}

function rectFootprint(cx: number, cy: number, w: number, d: number): Point2D[] {
  const hw = w / 2, hd = d / 2;
  return [
    { x: cx - hw, y: cy - hd }, { x: cx + hw, y: cy - hd },
    { x: cx + hw, y: cy + hd }, { x: cx - hw, y: cy + hd },
  ];
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

function aabbOverlap(a: ReturnType<typeof aabbOf>, b: ReturnType<typeof aabbOf>, gap = BLDG_GAP): boolean {
  return !(a.maxX + gap < b.minX || b.maxX + gap < a.minX || a.maxY + gap < b.minY || b.maxY + gap < a.minY);
}

function uid(prefix: string, i: number, seed: number): string {
  return `${prefix}-${(seed ^ (i * 2654435761)) >>> 0}`;
}

export interface GenerateOptions {
  roads?: { points: Point2D[]; halfWidthM: number }[];
}

/** Perimeter ring cells on axis-aligned inset bbox — buildings first, no court/drive kill. */
function parcelizeRectRing(
  minX: number, maxX: number, minY: number, maxY: number,
  depth: number, coverage: number
): { cx: number; cy: number; w: number; d: number }[] {
  const W = maxX - minX, D = maxY - minY;
  if (W < MIN_SIDE * 2 || D < MIN_SIDE * 2) {
    return [{ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: Math.max(MIN_SIDE, W * 0.7), d: Math.max(MIN_SIDE, D * 0.7) }];
  }
  let dUse = Math.min(depth, Math.min(W, D) * 0.28, 18);
  dUse = Math.max(MIN_SIDE, dUse);
  if (W < dUse * 2 + 6 || D < dUse * 2 + 6) {
    return [{ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: W * 0.75, d: D * 0.75 }];
  }
  const cells = [
    { cx: (minX + maxX) / 2, cy: minY + dUse / 2, w: W - 1, d: dUse },
    { cx: (minX + maxX) / 2, cy: maxY - dUse / 2, w: W - 1, d: dUse },
  ];
  const gap = D - 2 * dUse;
  if (gap >= MIN_SIDE) {
    cells.push({ cx: minX + dUse / 2, cy: (minY + maxY) / 2, w: dUse, d: gap - 1 });
    cells.push({ cx: maxX - dUse / 2, cy: (minY + maxY) / 2, w: dUse, d: gap - 1 });
  }
  const area = W * D;
  const ring = cells.reduce((s, c) => s + c.w * c.d, 0);
  if (ring > coverage * area && ring > 0) {
    const s = Math.sqrt((coverage * area) / ring);
    for (const c of cells) { c.w *= s; c.d *= s; }
  }
  return cells;
}

function segmentBar(cell: { cx: number; cy: number; w: number; d: number }): { cx: number; cy: number; w: number; d: number }[] {
  const long = Math.max(cell.w, cell.d);
  const short = Math.min(cell.w, cell.d);
  if (long <= MAX_BAR + 1) return [cell];
  const alongX = cell.w >= cell.d;
  const n = Math.max(2, Math.ceil((long + BLDG_GAP) / (MAX_BAR + BLDG_GAP)));
  const seg = (long - BLDG_GAP * (n - 1)) / n;
  if (seg < MIN_SIDE * 0.85) return [{ ...cell, w: alongX ? Math.min(cell.w, MAX_BAR) : cell.w, d: alongX ? cell.d : Math.min(cell.d, MAX_BAR) }];
  const out: { cx: number; cy: number; w: number; d: number }[] = [];
  const start = -long / 2 + seg / 2;
  for (let i = 0; i < n; i++) {
    const o = start + i * (seg + BLDG_GAP);
    out.push({
      cx: cell.cx + (alongX ? o : 0),
      cy: cell.cy + (alongX ? 0 : o),
      w: alongX ? seg : short,
      d: alongX ? short : seg,
    });
  }
  return out;
}

export function generateZoneContent(zone: ZoneRect, _opts: GenerateOptions = {}): ZoneGeneratedContent {
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
  const iMinX = minX + setback, iMaxX = maxX - setback, iMinY = minY + setback, iMaxY = maxY - setback;
  if (iMaxX - iMinX < MIN_SIDE || iMaxY - iMinY < MIN_SIDE) return empty;

  const zoneArea = Math.abs(signedArea(poly));
  const rng = mulberry32(params.seed);
  const buildings: GeneratedBuilding[] = [];
  const accepted: Point2D[][] = [];

  let cells: { cx: number; cy: number; w: number; d: number }[] = [];
  if (params.buildForm === 'tower') {
    const side = Math.min(36, Math.max(MIN_SIDE, Math.sqrt(zoneArea * Math.min(0.12, params.coverage * 0.5))));
    cells = [{ cx: (iMinX + iMaxX) / 2, cy: (iMinY + iMaxY) / 2, w: side, d: side * (0.8 + rng() * 0.3) }];
  } else if (params.buildForm === 'corridor') {
    const W = iMaxX - iMinX, D = iMaxY - iMinY;
    const alongX = W >= D;
    cells = [{
      cx: (iMinX + iMaxX) / 2, cy: (iMinY + iMaxY) / 2,
      w: alongX ? Math.min(W * 0.9, MAX_BAR * 2) : Math.min(params.parcelDepthM, W * 0.4),
      d: alongX ? Math.min(params.parcelDepthM, D * 0.4) : Math.min(D * 0.9, MAX_BAR * 2),
    }];
  } else if (params.buildForm === 'random') {
    const W = iMaxX - iMinX, D = iMaxY - iMinY;
    const avg = 140;
    const n = Math.max(1, Math.round((W * D * params.coverage) / avg));
    for (let k = 0; k < n * 40 && cells.length < n; k++) {
      const w = MIN_SIDE * (1 + rng() * 0.8), d = MIN_SIDE * (1 + rng() * 0.8);
      const cx = iMinX + w / 2 + rng() * Math.max(0.1, W - w);
      const cy = iMinY + d / 2 + rng() * Math.max(0.1, D - d);
      const fp = rectFootprint(cx, cy, w, d);
      if (!footprintFullyInside(fp, poly)) continue;
      const bb = aabbOf(fp);
      if (cells.some((c) => aabbOverlap(bb, aabbOf(rectFootprint(c.cx, c.cy, c.w, c.d))))) continue;
      cells.push({ cx, cy, w, d });
    }
  } else {
    cells = parcelizeRectRing(iMinX, iMaxX, iMinY, iMaxY, params.parcelDepthM, params.coverage);
  }

  const expanded: { cx: number; cy: number; w: number; d: number }[] = [];
  for (const c of cells) for (const s of segmentBar(c)) expanded.push(s);

  for (let i = 0; i < expanded.length; i++) {
    let { cx, cy, w, d } = expanded[i];
    w = Math.max(MIN_SIDE, Math.min(w, MAX_BAR));
    d = Math.max(MIN_SIDE, Math.min(d, MAX_BAR));
    let fp = rectFootprint(cx, cy, w, d);
    let ok = false;
    for (let a = 0; a < 8; a++) {
      if (footprintFullyInside(fp, poly) && !accepted.some((o) => aabbOverlap(aabbOf(fp), aabbOf(o)))) {
        ok = true;
        break;
      }
      w *= 0.88; d *= 0.88;
      if (w < MIN_SIDE * 0.9 || d < MIN_SIDE * 0.9) break;
      fp = rectFootprint(cx, cy, w, d);
    }
    if (!ok) continue;
    const fpA = footprintArea(fp);
    if (fpA < 40) continue;
    accepted.push(fp);

    let floors = Math.max(1, Math.min(params.maxFloors, Math.round((params.far * (zoneArea / Math.max(1, expanded.length))) / fpA)));
    floors = Math.max(1, Math.min(params.maxFloors, floors));
    buildings.push({
      id: uid(zone.id, i, params.seed),
      zoneId: zone.id,
      footprint: fp,
      heightM: floors * FLOOR_HEIGHT_M,
      floors,
      type: zone.type,
      buildForm: params.buildForm,
    });
  }

  if (buildings.length && params.far > 0 && zoneArea > 1) {
    let gfa = buildings.reduce((s, b) => s + footprintArea(b.footprint) * b.floors, 0);
    const target = params.far * zoneArea;
    while (gfa > target * 1.001) {
      let reduced = false;
      for (let i = buildings.length - 1; i >= 0; i--) {
        if (buildings[i].floors > 1) {
          buildings[i].floors -= 1;
          buildings[i].heightM = buildings[i].floors * FLOOR_HEIGHT_M;
          gfa -= footprintArea(buildings[i].footprint);
          reduced = true;
          break;
        }
      }
      if (!reduced) break;
    }
  }

  const courtyards: ZoneCourtyard[] = [];
  if (buildings.length >= 2 && params.buildForm === 'block') {
    const c = polyCentroid(poly);
    const innerW = Math.max(6, (iMaxX - iMinX) * 0.25);
    const innerD = Math.max(6, (iMaxY - iMinY) * 0.25);
    const court = rectFootprint(c.x, c.y, innerW, innerD);
    if (footprintFullyInside(court, poly) && !accepted.some((fp) => aabbOverlap(aabbOf(fp), aabbOf(court), 2))) {
      courtyards.push({
        id: uid(`${zone.id}-court`, 0, params.seed),
        zoneId: zone.id,
        polygon: court,
        kind: 'court',
        trees: [],
      });
    }
  }

  void rng;
  return { buildings, driveways: [] as ZoneDriveway[], courtyards };
}

export function generateBuildingsForZone(zone: ZoneRect, opts: GenerateOptions = {}): GeneratedBuilding[] {
  return generateZoneContent(zone, opts).buildings;
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
