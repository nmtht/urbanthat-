import type { Point2D } from './SceneOrigin';

/** Per-road overrides applied on top of the base profile. */
export interface RoadOptions {
  /** Number of traffic lanes (1–6). */
  lanes?: number;
  /** Parallel parking strip width per side, metres (0 = off). */
  parkingM?: number;
  /** Green buffer / verge width per side, metres (0 = off). */
  greenBufferM?: number;
  /** Sidewalk width override (undefined = profile default). */
  sidewalkM?: number;
}

/** User-drawn road centerline in local metric XY (same SK as OSM). */
export interface RoadCenterline {
  id: string;
  points: Point2D[];
  profileId: RoadProfileId;
  options?: RoadOptions;
  tags?: Record<string, string>;
}

export type RoadProfileId =
  | 'residential'
  | 'tertiary'
  | 'primary'
  | 'service'
  | 'footway';

export interface RoadProfile {
  id: RoadProfileId;
  label: string;
  /** Base carriageway width for default lane count. */
  widthM: number;
  lanes: number;
  centerLine: boolean;
  sidewalkM: number;
  curbRadiusM: number;
  asphaltColor: string;
  markingColor: string;
}

export const ROAD_PROFILES: Record<RoadProfileId, RoadProfile> = {
  residential: {
    id: 'residential',
    label: 'Residential',
    widthM: 6.5,
    lanes: 2,
    centerLine: true,
    sidewalkM: 1.5,
    curbRadiusM: 3.0,
    asphaltColor: '#2c2c2e',
    markingColor: '#c8c4a8',
  },
  tertiary: {
    id: 'tertiary',
    label: 'Tertiary',
    widthM: 9.0,
    lanes: 2,
    centerLine: true,
    sidewalkM: 1.8,
    curbRadiusM: 4.0,
    asphaltColor: '#2c2c2e',
    markingColor: '#c8c4a8',
  },
  primary: {
    id: 'primary',
    label: 'Primary',
    widthM: 12.0,
    lanes: 4,
    centerLine: true,
    sidewalkM: 2.0,
    curbRadiusM: 6.0,
    asphaltColor: '#2a2a2c',
    markingColor: '#c8c4a8',
  },
  service: {
    id: 'service',
    label: 'Service',
    widthM: 4.0,
    lanes: 1,
    centerLine: false,
    sidewalkM: 0,
    curbRadiusM: 2.0,
    asphaltColor: '#323230',
    markingColor: '#c8c4a8',
  },
  footway: {
    id: 'footway',
    label: 'Footway',
    widthM: 2.0,
    lanes: 1,
    centerLine: false,
    sidewalkM: 0,
    curbRadiusM: 1.0,
    asphaltColor: '#4a4844',
    markingColor: '#c8c4a8',
  },
};

export const ROAD_PROFILE_ORDER: RoadProfileId[] = [
  'residential',
  'tertiary',
  'primary',
  'service',
  'footway',
];

export function getRoadProfile(id: RoadProfileId): RoadProfile {
  return ROAD_PROFILES[id] ?? ROAD_PROFILES.residential;
}

const LANE_WIDTH_M = 3.25;

/**
 * Effective geometry sizes for a road (profile defaults + options).
 */
export function resolveRoadGeometry(
  profileId: RoadProfileId,
  options?: RoadOptions
): {
  profile: RoadProfile;
  lanes: number;
  carriageWidthM: number;
  parkingM: number;
  greenBufferM: number;
  sidewalkM: number;
  totalHalfM: number;
} {
  const profile = getRoadProfile(profileId);
  const lanes = Math.max(1, Math.min(6, options?.lanes ?? profile.lanes));
  const parkingM = Math.max(0, options?.parkingM ?? 0);
  const greenBufferM = Math.max(0, options?.greenBufferM ?? 0);
  const sidewalkM =
    options?.sidewalkM !== undefined ? Math.max(0, options.sidewalkM) : profile.sidewalkM;
  const baseLaneW = profile.widthM / Math.max(1, profile.lanes);
  const carriageWidthM = lanes * (Number.isFinite(baseLaneW) ? baseLaneW : LANE_WIDTH_M);
  const totalHalfM = carriageWidthM / 2 + parkingM + greenBufferM;
  return {
    profile,
    lanes,
    carriageWidthM,
    parkingM,
    greenBufferM,
    sidewalkM,
    totalHalfM,
  };
}

export type DrawMode = 'straight' | 'curve' | 'freehand';
export type ZoneDrawMode = 'rect' | 'polygon' | 'freehand';
