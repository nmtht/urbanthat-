import type { Point2D } from '../domain/SceneOrigin';

/** 2D geometry: polyline offset (miter) + Sutherland-Hodgman rect clip. */

function sub(a: Point2D, b: Point2D): Point2D { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Point2D, b: Point2D): Point2D { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Point2D, s: number): Point2D { return { x: a.x * s, y: a.y * s }; }
function len(a: Point2D): number { return Math.hypot(a.x, a.y); }
function norm(a: Point2D): Point2D { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
function perp(a: Point2D): Point2D { return { x: -a.y, y: a.x }; }
function dot(a: Point2D, b: Point2D): number { return a.x * b.x + a.y * b.y; }

export function simplifyPolyline(pts: Point2D[], minDist = 0.3): Point2D[] {
  if (pts.length < 2) return pts.slice();
  const out: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) >= minDist) out.push(pts[i]);
  }
  if (out.length === 1 && pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}

export function offsetPolyline(ptsIn: Point2D[], dist: number, miterLimit = 3): { left: Point2D[]; right: Point2D[] } {
  const pts = simplifyPolyline(ptsIn);
  if (pts.length < 2) return { left: [], right: [] };
  const left: Point2D[] = [];
  const right: Point2D[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const curr = pts[i];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dirIn = norm(sub(curr, prev));
    let dirOut = norm(sub(next, curr));
    if (i === 0) dirIn = dirOut;
    if (i === pts.length - 1) dirOut = dirIn;
    const nIn = perp(dirIn);
    const nOut = perp(dirOut);
    let m = add(nIn, nOut);
    const ml = len(m);
    m = ml < 1e-8 ? nIn : mul(m, 1 / ml);
    const cos = Math.max(dot(m, nIn), 1e-4);
    let scale = 1 / cos;
    if (scale > miterLimit) scale = miterLimit;
    left.push(add(curr, mul(m, dist * scale)));
    right.push(add(curr, mul(m, -dist * scale)));
  }
  return { left, right };
}

export function corridorPolygon(left: Point2D[], right: Point2D[]): Point2D[] {
  if (left.length < 2 || right.length < 2) return [];
  return [...left, ...right.slice().reverse()];
}

export interface Rect { minX: number; minY: number; maxX: number; maxY: number; }

function intersectX(a: Point2D, b: Point2D, x: number): Point2D {
  const dx = b.x - a.x;
  const t = Math.abs(dx) < 1e-12 ? 0 : (x - a.x) / dx;
  return { x, y: a.y + t * (b.y - a.y) };
}
function intersectY(a: Point2D, b: Point2D, y: number): Point2D {
  const dy = b.y - a.y;
  const t = Math.abs(dy) < 1e-12 ? 0 : (y - a.y) / dy;
  return { x: a.x + t * (b.x - a.x), y };
}

export function clipPolygonToRect(poly: Point2D[], rect: Rect): Point2D[] {
  if (poly.length < 3) return [];
  type EdgeFn = [(p: Point2D) => boolean, (a: Point2D, b: Point2D) => Point2D];
  const edges: EdgeFn[] = [
    [(p) => p.x >= rect.minX, (a, b) => intersectX(a, b, rect.minX)],
    [(p) => p.x <= rect.maxX, (a, b) => intersectX(a, b, rect.maxX)],
    [(p) => p.y >= rect.minY, (a, b) => intersectY(a, b, rect.minY)],
    [(p) => p.y <= rect.maxY, (a, b) => intersectY(a, b, rect.maxY)],
  ];
  let output = poly;
  for (const [inside, intersect] of edges) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output.length >= 3 ? output : [];
}

function clipSegmentToRect(insidePt: Point2D, outsidePt: Point2D, rect: Rect): Point2D {
  const dx = outsidePt.x - insidePt.x;
  const dy = outsidePt.y - insidePt.y;
  let t = 1;
  const candidates: number[] = [];
  if (dx !== 0) {
    candidates.push((rect.minX - insidePt.x) / dx);
    candidates.push((rect.maxX - insidePt.x) / dx);
  }
  if (dy !== 0) {
    candidates.push((rect.minY - insidePt.y) / dy);
    candidates.push((rect.maxY - insidePt.y) / dy);
  }
  for (const c of candidates) {
    if (c > 0 && c <= 1) t = Math.min(t, c);
  }
  return { x: insidePt.x + t * dx, y: insidePt.y + t * dy };
}

export function clipPolylineToRect(pts: Point2D[], rect: Rect): Point2D[][] {
  if (pts.length < 2) return [];
  const segments: Point2D[][] = [];
  let current: Point2D[] = [];
  const inside = (p: Point2D) =>
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn && bIn) {
      if (current.length === 0) current.push(a);
      current.push(b);
    } else if (aIn && !bIn) {
      if (current.length === 0) current.push(a);
      current.push(clipSegmentToRect(a, b, rect));
      if (current.length >= 2) segments.push(current);
      current = [];
    } else if (!aIn && bIn) {
      current = [clipSegmentToRect(b, a, rect), b];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}
