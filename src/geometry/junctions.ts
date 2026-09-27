/**
 * Detect road intersections and produce circular junction pads.
 */
import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline } from '../domain/roads';
import { resolveRoadGeometry } from '../domain/roads';
import { circlePolygon } from './polygonBoolean';

function segIntersect(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): Point2D | null {
  const dx1 = b.x - a.x;
  const dy1 = b.y - a.y;
  const dx2 = d.x - c.x;
  const dy2 = d.y - c.y;
  const cross = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / cross;
  const u = ((c.x - a.x) * dy1 - (c.y - a.y) * dx1) / cross;
  if (t < 0.02 || t > 0.98 || u < 0.02 || u > 0.98) return null;
  return { x: a.x + t * dx1, y: a.y + t * dy1 };
}

function near(a: Point2D, b: Point2D, eps = 1.5): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < eps;
}

/**
 * Find crossing points between different roads + multi-road endpoints → hub disks.
 */
export function findJunctionHubs(roads: RoadCenterline[]): Point2D[][] {
  const hubs: { p: Point2D; r: number }[] = [];

  const widthOf = (road: RoadCenterline) =>
    resolveRoadGeometry(road.profileId, road.options).carriageWidthM;

  const endpoints: { p: Point2D; r: number; id: string }[] = [];
  for (const road of roads) {
    if (road.points.length < 2) continue;
    const half = widthOf(road) / 2;
    for (const p of [road.points[0], road.points[road.points.length - 1]]) {
      endpoints.push({ p, r: half, id: road.id });
    }
  }
  const used = new Set<number>();
  for (let i = 0; i < endpoints.length; i++) {
    if (used.has(i)) continue;
    const cluster = [endpoints[i]];
    used.add(i);
    for (let j = i + 1; j < endpoints.length; j++) {
      if (used.has(j)) continue;
      if (near(endpoints[i].p, endpoints[j].p, 3.0)) {
        cluster.push(endpoints[j]);
        used.add(j);
      }
    }
    const roadIds = new Set(cluster.map((c) => c.id));
    if (roadIds.size >= 2) {
      const cx = cluster.reduce((s, c) => s + c.p.x, 0) / cluster.length;
      const cy = cluster.reduce((s, c) => s + c.p.y, 0) / cluster.length;
      const r = Math.max(...cluster.map((c) => c.r)) + 1.5;
      hubs.push({ p: { x: cx, y: cy }, r });
    }
  }

  for (let i = 0; i < roads.length; i++) {
    const A = roads[i].points;
    if (A.length < 2) continue;
    const rA = widthOf(roads[i]) / 2;
    for (let j = i + 1; j < roads.length; j++) {
      const B = roads[j].points;
      if (B.length < 2) continue;
      const rB = widthOf(roads[j]) / 2;
      for (let ai = 0; ai < A.length - 1; ai++) {
        for (let bi = 0; bi < B.length - 1; bi++) {
          const hit = segIntersect(A[ai], A[ai + 1], B[bi], B[bi + 1]);
          if (!hit) continue;
          if (hubs.some((h) => near(h.p, hit, h.r * 0.8))) continue;
          hubs.push({ p: hit, r: Math.max(rA, rB) + 1.8 });
        }
      }
    }
  }

  return hubs.map((h) => circlePolygon(h.p.x, h.p.y, h.r, 20) as Point2D[]);
}
