import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline, RoadProfile } from '../domain/roads';
import { getRoadProfile } from '../domain/roads';
import {
  simplifyPolyline,
  offsetPolyline,
  roundOffsetPolyline,
  corridorPolygon,
} from './polylineOffset';
import { unionPolygonsSafe, hubPad } from './clipperUnion';

export interface RoadGeometry {
  id: string;
  carriagePolys: Point2D[][];
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

function angleAt(pts: Point2D[], i: number): number {
  if (i <= 0 || i >= pts.length - 1) return 180;
  const a = pts[i - 1];
  const b = pts[i];
  const c = pts[i + 1];
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d1 = Math.hypot(v1x, v1y) || 1;
  const d2 = Math.hypot(v2x, v2y) || 1;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (d1 * d2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function buildSingleRoadGeometry(road: RoadCenterline): {
  carriage: Point2D[];
  sidewalks: Point2D[];
  markings: Point2D[][];
  profile: RoadProfile;
  pts: Point2D[];
} | null {
  const profile = getRoadProfile(road.profileId);
  const pts = simplifyPolyline(road.points, 0.4);
  if (pts.length < 2) return null;

  const half = profile.widthM / 2;
  const { left, right } =
    profile.curbRadiusM > 0.2
      ? roundOffsetPolyline(pts, half, Math.min(profile.curbRadiusM, half * 0.9))
      : offsetPolyline(pts, half, 2.5);

  if (left.length < 2 || right.length < 2) return null;
  const carriage = corridorPolygon(left, right);
  if (carriage.length < 3) return null;

  const sidewalks: Point2D[] = [];
  if (profile.sidewalkM > 0.1) {
    const outerHalf = half + profile.sidewalkM;
    const { left: l2, right: r2 } = offsetPolyline(pts, outerHalf, 2.5);
    if (l2.length >= 2 && r2.length >= 2) {
      const outer = corridorPolygon(l2, r2);
      if (outer.length >= 3) sidewalks.push(...outer);
    }
  }

  const markings: Point2D[][] = [];
  if (profile.centerLine && profile.lanes >= 2) {
    dashedSegments(pts, 2.5, 2.0, markings);
  }

  return { carriage, sidewalks, markings, profile, pts };
}

export function buildNetworkGeometry(roads: RoadCenterline[]): RoadGeometry[] {
  if (roads.length === 0) return [];

  type Acc = {
    road: RoadCenterline;
    profile: RoadProfile;
    pts: Point2D[];
    markings: Point2D[][];
    carriagePieces: Point2D[][];
    sidewalkPieces: Point2D[][];
  };

  const byId = new Map<string, Acc>();
  const allCarriage: Point2D[][] = [];
  const hubPieces: Point2D[][] = [];
  const endpointMap = new Map<string, { x: number; y: number; roadIds: string[]; half: number }>();
  const keyOf = (p: Point2D) => `${Math.round(p.x * 2) / 2},${Math.round(p.y * 2) / 2}`;

  for (const road of roads) {
    const single = buildSingleRoadGeometry(road);
    if (!single) continue;

    byId.set(road.id, {
      road,
      profile: single.profile,
      pts: single.pts,
      markings: single.markings,
      carriagePieces: [single.carriage],
      sidewalkPieces: single.sidewalks.length >= 3 ? [single.sidewalks] : [],
    });

    allCarriage.push(single.carriage);

    const half = single.profile.widthM / 2;
    const curb = single.profile.curbRadiusM;

    for (let i = 1; i < single.pts.length - 1; i++) {
      const ang = angleAt(single.pts, i);
      if (ang < 150) {
        const r = half + Math.max(curb * 0.35, 0.4);
        hubPieces.push(hubPad(single.pts[i].x, single.pts[i].y, r, 18));
      }
    }

    for (const ep of [single.pts[0], single.pts[single.pts.length - 1]]) {
      const k = keyOf(ep);
      let e = endpointMap.get(k);
      if (!e) {
        e = { x: ep.x, y: ep.y, roadIds: [], half };
        endpointMap.set(k, e);
      }
      e.roadIds.push(road.id);
      e.half = Math.max(e.half, half);
    }
  }

  for (const e of endpointMap.values()) {
    if (e.roadIds.length >= 2) {
      hubPieces.push(hubPad(e.x, e.y, e.half + 1.2, 20));
    }
  }

  const united = unionPolygonsSafe([...allCarriage, ...hubPieces]);
  const result: RoadGeometry[] = [];

  if (united.length === 0) {
    for (const acc of byId.values()) {
      result.push({
        id: acc.road.id,
        carriagePolys: acc.carriagePieces,
        sidewalkPolys: acc.sidewalkPieces,
        markingSegments: acc.markings,
        profile: acc.profile,
        centerline: { ...acc.road, points: acc.pts },
      });
    }
    return result;
  }

  const assigned = new Set<number>();
  for (const acc of byId.values()) {
    const carriagePolys: Point2D[][] = [];
    for (let i = 0; i < united.length; i++) {
      if (assigned.has(i)) continue;
      const poly = united[i];
      let near = false;
      for (const c of acc.pts) {
        for (const p of poly) {
          if (Math.hypot(p.x - c.x, p.y - c.y) < acc.profile.widthM + 4) {
            near = true;
            break;
          }
        }
        if (near) break;
      }
      if (near) {
        carriagePolys.push(poly);
        assigned.add(i);
      }
    }
    if (carriagePolys.length === 0) carriagePolys.push(...acc.carriagePieces);

    const sidewalkPolys =
      acc.sidewalkPieces.length > 0 ? unionPolygonsSafe(acc.sidewalkPieces) : [];

    result.push({
      id: acc.road.id,
      carriagePolys,
      sidewalkPolys,
      markingSegments: acc.markings,
      profile: acc.profile,
      centerline: { ...acc.road, points: acc.pts },
    });
  }

  if (result.length > 0) {
    for (let i = 0; i < united.length; i++) {
      if (!assigned.has(i)) result[0].carriagePolys.push(united[i]);
    }
  }

  return result;
}

export function buildRoadGeometry(road: RoadCenterline): {
  id: string;
  carriagePoly: Point2D[];
  markingSegments: Point2D[][];
  profile: RoadProfile;
  centerline: RoadCenterline;
} | null {
  const s = buildSingleRoadGeometry(road);
  if (!s) return null;
  return {
    id: road.id,
    carriagePoly: s.carriage,
    markingSegments: s.markings,
    profile: s.profile,
    centerline: { ...road, points: s.pts },
  };
}
