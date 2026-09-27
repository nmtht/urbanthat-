import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline, RoadProfile } from '../domain/roads';
import { getRoadProfile } from '../domain/roads';
import {
  simplifyPolyline,
  offsetPolyline,
  corridorPolygon,
} from './polylineOffset';

export interface RoadGeometry {
  id: string;
  carriagePoly: Point2D[];
  markingSegments: Point2D[][];
  profile: RoadProfile;
  centerline: RoadCenterline;
}

/** Build carriage polygon + dashed centerline segments from a centerline. */
export function buildRoadGeometry(road: RoadCenterline): RoadGeometry | null {
  const profile = getRoadProfile(road.profileId);
  const pts = simplifyPolyline(road.points, 0.4);
  if (pts.length < 2) return null;

  const half = profile.widthM / 2;
  const { left, right } = offsetPolyline(pts, half, 2.5);
  if (left.length < 2 || right.length < 2) return null;

  const carriage = corridorPolygon(left, right);
  if (carriage.length < 3) return null;

  const markingSegments: Point2D[][] = [];
  if (profile.centerLine && profile.lanes >= 2) {
    dashedSegments(pts, 2.5, 2.0, markingSegments);
  }

  return {
    id: road.id,
    carriagePoly: carriage,
    markingSegments,
    profile,
    centerline: { ...road, points: pts },
  };
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

/** Local XY → Three.js world (y-up, z = -y). */
export function localToWorld(p: Point2D, yUp = 0): { x: number; y: number; z: number } {
  return { x: p.x, y: yUp, z: -p.y };
}
