/** Zone content pipeline (Sprint 4) — corridor unified strip plan. */

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

SEE_ARTIFACT_FOR_REST
