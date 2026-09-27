import type { Point2D } from './SceneOrigin';
import type { RoadCenterline } from './roads';
import { resolveRoadGeometry } from './roads';
import type { ZoneRect } from './zones';
import { zoneAreaM2 } from './zones';

export function polylineLengthM(pts: Point2D[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return len;
}

export function roadLengthM(road: RoadCenterline): number {
  return polylineLengthM(road.points);
}

export function roadAreaM2(road: RoadCenterline): number {
  const g = resolveRoadGeometry(road.profileId, road.options);
  return roadLengthM(road) * g.carriageWidthM;
}

export interface SceneStats {
  boundaryAreaM2: number | null;
  roadCount: number;
  roadLengthM: number;
  zoneCount: number;
  zoneAreaM2: number;
  byType: Record<string, { count: number; areaM2: number }>;
}

export function computeSceneStats(
  roads: RoadCenterline[],
  zones: ZoneRect[]
): SceneStats {
  const boundaries = zones.filter((z) => z.type === 'boundary');
  const regular = zones.filter((z) => z.type !== 'boundary');

  let boundaryAreaM2: number | null = null;
  if (boundaries.length > 0) {
    boundaryAreaM2 = boundaries.reduce((s, z) => s + zoneAreaM2(z), 0);
  }

  const byType: Record<string, { count: number; areaM2: number }> = {};
  for (const z of regular) {
    const t = z.type;
    if (!byType[t]) byType[t] = { count: 0, areaM2: 0 };
    byType[t].count += 1;
    byType[t].areaM2 += zoneAreaM2(z);
  }

  return {
    boundaryAreaM2,
    roadCount: roads.length,
    roadLengthM: roads.reduce((s, r) => s + roadLengthM(r), 0),
    zoneCount: regular.length,
    zoneAreaM2: regular.reduce((s, z) => s + zoneAreaM2(z), 0),
    byType,
  };
}

export function formatM(m: number, units: 'm' | 'ft' = 'm'): string {
  if (units === 'ft') {
    const ft = m * 3.28084;
    return ft >= 1000 ? `${(ft / 5280).toFixed(2)} mi` : `${ft.toFixed(1)} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
}

export function formatArea(m2: number, units: 'm' | 'ft' = 'm'): string {
  if (units === 'ft') {
    const sqft = m2 * 10.7639;
    return sqft >= 43560
      ? `${(sqft / 43560).toFixed(2)} ac`
      : `${sqft.toFixed(0)} ft²`;
  }
  return m2 >= 10_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;
}
