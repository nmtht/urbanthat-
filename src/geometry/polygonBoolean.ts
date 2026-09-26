/**
 * Lightweight polygon union for road corridors.
 * Pure TS — no WASM required at runtime.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Signed area (positive = CCW). */
function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a * 0.5;
}

function ensureCcw(poly: Pt[]): Pt[] {
  return area(poly) < 0 ? poly.slice().reverse() : poly;
}

function aabb(p: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const q of p) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  return { minX, minY, maxX, maxY };
}

function overlaps(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
) {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/** Convex hull (Andrew's monotone chain). */
function convexHull(pts: Pt[]): Pt[] {
  const sorted = pts.slice().sort((u, v) => (u.x === v.x ? u.y - v.y : u.x - v.x));
  if (sorted.length <= 2) return sorted;
  const cross2 = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Approximate union of near-convex road polygons.
 * Overlapping corridors at junctions are merged via convex hull.
 */
export function unionPolygons(polys: Pt[][]): Pt[][] {
  const cleaned = polys
    .map((p) =>
      ensureCcw(
        p.filter((_, i, arr) => {
          if (arr.length < 3) return true;
          const prev = arr[(i + arr.length - 1) % arr.length];
          return Math.hypot(p[i].x - prev.x, p[i].y - prev.y) > 1e-4;
        })
      )
    )
    .filter((p) => p.length >= 3 && Math.abs(area(p)) > 0.05);

  if (cleaned.length <= 1) return cleaned;

  let active = cleaned.map((p) => ({ poly: p, box: aabb(p), dead: false }));
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 2000) {
    merged = false;
    for (let i = 0; i < active.length; i++) {
      if (active[i].dead) continue;
      for (let j = i + 1; j < active.length; j++) {
        if (active[j].dead) continue;
        if (!overlaps(active[i].box, active[j].box)) continue;
        const ai = active[i].box;
        const aj = active[j].box;
        const ci = { x: (ai.minX + ai.maxX) / 2, y: (ai.minY + ai.maxY) / 2 };
        const cj = { x: (aj.minX + aj.maxX) / 2, y: (aj.minY + aj.maxY) / 2 };
        const di = Math.hypot(ai.maxX - ai.minX, ai.maxY - ai.minY);
        const dj = Math.hypot(aj.maxX - aj.minX, aj.maxY - aj.minY);
        if (Math.hypot(ci.x - cj.x, ci.y - cj.y) > (di + dj) * 0.55) continue;

        const hull = convexHull(active[i].poly.concat(active[j].poly));
        if (hull.length < 3) continue;
        active[i] = { poly: hull, box: aabb(hull), dead: false };
        active[j].dead = true;
        merged = true;
      }
    }
    if (merged) active = active.filter((a) => !a.dead);
  }

  return active.filter((a) => !a.dead).map((a) => a.poly);
}

/** Circular junction pad. */
export function circlePolygon(cx: number, cy: number, r: number, segments = 16): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}
