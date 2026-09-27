import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline, RoadProfile } from '../domain/roads';
import { resolveRoadGeometry } from '../domain/roads';
import {
  simplifyPolyline,
  offsetPolyline,
  corridorPolygon,
} from './polylineOffset';
import { findJunctionHubs } from './junctions';

export interface RoadGeometry {
  id: string;
  carriagePoly: Point2D[];
  parkingPolys: Point2D[][];
  greenPolys: Point2D[][];
  sidewalkPolys: Point2D[][];
  markingSegments: Point2D[][];
  profile: RoadProfile;
  centerline: RoadCenterline;
  carriageWidthM: number;
}

export function localToWorld(p: Point2D, yUp = 0): { x: number; y: number; z: number } {
  return { x: p.x, y: yUp, z: -p.y };
}

function dashedSegments(
  centerline: Point2D[],
  dash: number,
  gap: number,
  out: Point2D[][]
): void {
  const pts = simplifyPolyline(centerline, 0.5);
  let remaining = 0;
  let drawing = true;
  let dashStart: Point2D | null = null;

  for (let i = 0; i < pts.length - 1; i++) {
    let a = pts[i];
    const b = pts[i + 1];
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-6) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;

    while (segLen > 1e-6) {
      const need = drawing ? dash - remaining : gap - remaining;
      const step = Math.min(need, segLen);
      const nx = a.x + dx * step;
      const ny = a.y + dy * step;
      if (drawing) {
        if (!dashStart) dashStart = a;
        if (remaining + step >= dash - 1e-6 || step >= segLen - 1e-6) {
          out.push([dashStart, { x: nx, y: ny }]);
          dashStart = null;
        }
      }
      a = { x: nx, y: ny };
      segLen -= step;
      remaining += step;
      const limit = drawing ? dash : gap;
      if (remaining >= limit - 1e-6) {
        remaining = 0;
        drawing = !drawing;
        if (!drawing) dashStart = null;
      }
    }
  }
}

function stripBetween(inner: Point2D[], outer: Point2D[]): Point2D[] | null {
  if (inner.length < 2 || outer.length < 2) return null;
  const strip = [...outer, ...inner.slice().reverse()];
  return strip.length >= 3 ? strip : null;
}

export function buildRoadGeometry(road: RoadCenterline): RoadGeometry | null {
  const g = resolveRoadGeometry(road.profileId, road.options);
  const pts = simplifyPolyline(road.points, 0.4);
  if (pts.length < 2) return null;

  const halfC = g.carriageWidthM / 2;
  const { left, right } = offsetPolyline(pts, halfC, 2.5);
  if (left.length < 2 || right.length < 2) return null;
  const carriagePoly = corridorPolygon(left, right);
  if (carriagePoly.length < 3) return null;

  const parkingPolys: Point2D[][] = [];
  const greenPolys: Point2D[][] = [];
  const sidewalkPolys: Point2D[][] = [];

  let outerHalf = halfC;

  if (g.parkingM > 0.05) {
    const next = outerHalf + g.parkingM;
    const { left: l2, right: r2 } = offsetPolyline(pts, next, 2.5);
    const { left: l1, right: r1 } = offsetPolyline(pts, outerHalf, 2.5);
    const sl = stripBetween(l1, l2);
    const sr = stripBetween(r1, r2);
    if (sl) parkingPolys.push(sl);
    if (sr) parkingPolys.push(sr);
    outerHalf = next;
  }

  if (g.greenBufferM > 0.05) {
    const next = outerHalf + g.greenBufferM;
    const { left: l2, right: r2 } = offsetPolyline(pts, next, 2.5);
    const { left: l1, right: r1 } = offsetPolyline(pts, outerHalf, 2.5);
    const sl = stripBetween(l1, l2);
    const sr = stripBetween(r1, r2);
    if (sl) greenPolys.push(sl);
    if (sr) greenPolys.push(sr);
    outerHalf = next;
  }

  if (g.sidewalkM > 0.05) {
    const next = outerHalf + g.sidewalkM;
    const { left: l2, right: r2 } = offsetPolyline(pts, next, 2.5);
    const { left: l1, right: r1 } = offsetPolyline(pts, outerHalf, 2.5);
    const sl = stripBetween(l1, l2);
    const sr = stripBetween(r1, r2);
    if (sl) sidewalkPolys.push(sl);
    if (sr) sidewalkPolys.push(sr);
  }

  const markingSegments: Point2D[][] = [];
  if (g.profile.centerLine && g.lanes >= 2) {
    dashedSegments(pts, 2.5, 2.0, markingSegments);
  }

  return {
    id: road.id,
    carriagePoly,
    parkingPolys,
    greenPolys,
    sidewalkPolys,
    markingSegments,
    profile: g.profile,
    centerline: { ...road, points: pts },
    carriageWidthM: g.carriageWidthM,
  };
}

export function buildNetworkGeometry(roads: RoadCenterline[]): {
  roads: RoadGeometry[];
  hubs: Point2D[][];
} {
  const out: RoadGeometry[] = [];
  for (const road of roads) {
    const g = buildRoadGeometry(road);
    if (g) out.push(g);
  }
  const hubs = findJunctionHubs(roads);
  return { roads: out, hubs };
}
