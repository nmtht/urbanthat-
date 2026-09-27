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
  /** Single corridor polygon for this road (no network hull). */
  carriagePoly: Point2D[];
  /** Optional left/right sidewalk strip polygons. */
  sidewalkPolys: Point2D[][];
  markingSegments: Point2D[][];
  profile: RoadProfile;
  centerline: RoadCenterline;
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

/** Build geometry for one road — independent corridor, no network merge. */
export function buildRoadGeometry(road: RoadCenterline): RoadGeometry | null {
  const profile = getRoadProfile(road.profileId);
  const pts = simplifyPolyline(road.points, 0.4);
  if (pts.length < 2) return null;

  const half = profile.widthM / 2;
  const { left, right } = offsetPolyline(pts, half, 2.5);
  if (left.length < 2 || right.length < 2) return null;

  const carriagePoly = corridorPolygon(left, right);
  if (carriagePoly.length < 3) return null;

  // Sidewalk strips: band between half and half+sidewalk on each side
  const sidewalkPolys: Point2D[][] = [];
  if (profile.sidewalkM > 0.1) {
    const outerHalf = half + profile.sidewalkM;
    const { left: lOut, right: rOut } = offsetPolyline(pts, outerHalf, 2.5);
    if (lOut.length >= 2 && left.length >= 2) {
      // left strip: outer-left forward, inner-left reversed
      const stripL = [...lOut, ...left.slice().reverse()];
      if (stripL.length >= 3) sidewalkPolys.push(stripL);
    }
    if (rOut.length >= 2 && right.length >= 2) {
      const stripR = [...right, ...rOut.slice().reverse()];
      if (stripR.length >= 3) sidewalkPolys.push(stripR);
    }
  }

  const markingSegments: Point2D[][] = [];
  if (profile.centerLine && profile.lanes >= 2) {
    dashedSegments(pts, 2.5, 2.0, markingSegments);
  }

  return {
    id: road.id,
    carriagePoly,
    sidewalkPolys,
    markingSegments,
    profile,
    centerline: { ...road, points: pts },
  };
}

/** Build all roads independently (no convex-hull union — that created giant blobs). */
export function buildNetworkGeometry(roads: RoadCenterline[]): RoadGeometry[] {
  const out: RoadGeometry[] = [];
  for (const road of roads) {
    const g = buildRoadGeometry(road);
    if (g) out.push(g);
  }
  return out;
}
