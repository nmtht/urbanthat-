/** OSM highway class → carriageway + sidewalk widths (metres). */

export interface RoadProfile {
  widthM: number;
  sidewalkM: number;
  lanes: number;
  centerLine: boolean;
}

const DEFAULT: RoadProfile = {
  widthM: 6,
  sidewalkM: 1.2,
  lanes: 2,
  centerLine: true,
};

const BY_HIGHWAY: Record<string, RoadProfile> = {
  motorway: { widthM: 14, sidewalkM: 0, lanes: 4, centerLine: true },
  motorway_link: { widthM: 7, sidewalkM: 0, lanes: 2, centerLine: true },
  trunk: { widthM: 12, sidewalkM: 1.5, lanes: 4, centerLine: true },
  trunk_link: { widthM: 6, sidewalkM: 0, lanes: 2, centerLine: true },
  primary: { widthM: 10, sidewalkM: 2, lanes: 3, centerLine: true },
  primary_link: { widthM: 6, sidewalkM: 1, lanes: 2, centerLine: true },
  secondary: { widthM: 9, sidewalkM: 1.8, lanes: 2, centerLine: true },
  secondary_link: { widthM: 6, sidewalkM: 1, lanes: 2, centerLine: true },
  tertiary: { widthM: 8, sidewalkM: 1.5, lanes: 2, centerLine: true },
  tertiary_link: { widthM: 5.5, sidewalkM: 1, lanes: 2, centerLine: true },
  residential: { widthM: 6.5, sidewalkM: 1.5, lanes: 2, centerLine: false },
  living_street: { widthM: 5, sidewalkM: 1.2, lanes: 1, centerLine: false },
  service: { widthM: 4.5, sidewalkM: 0.8, lanes: 1, centerLine: false },
  unclassified: { widthM: 6, sidewalkM: 1.2, lanes: 2, centerLine: true },
  road: { widthM: 6, sidewalkM: 1, lanes: 2, centerLine: false },
  pedestrian: { widthM: 4, sidewalkM: 0, lanes: 1, centerLine: false },
  footway: { widthM: 2, sidewalkM: 0, lanes: 1, centerLine: false },
  path: { widthM: 1.5, sidewalkM: 0, lanes: 1, centerLine: false },
  cycleway: { widthM: 2.5, sidewalkM: 0, lanes: 1, centerLine: false },
  steps: { widthM: 2, sidewalkM: 0, lanes: 1, centerLine: false },
  track: { widthM: 3, sidewalkM: 0, lanes: 1, centerLine: false },
};

export function roadProfile(highway: string, tags?: Record<string, string>): RoadProfile {
  const base = BY_HIGHWAY[highway] ?? DEFAULT;
  let widthM = base.widthM;
  let lanes = base.lanes;
  if (tags?.lanes) {
    const n = parseInt(tags.lanes, 10);
    if (!Number.isNaN(n) && n > 0) {
      lanes = n;
      widthM = Math.max(widthM, n * 3.2);
    }
  }
  if (tags?.width) {
    const w = parseFloat(tags.width);
    if (!Number.isNaN(w) && w > 0) widthM = w;
  }
  return {
    widthM,
    sidewalkM: base.sidewalkM,
    lanes,
    centerLine: base.centerLine && lanes >= 2,
  };
}

export function isFootOnly(highway: string): boolean {
  return ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(highway);
}
