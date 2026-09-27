import type { Point2D } from './SceneOrigin';

export type ZoneType = 'residential' | 'commercial' | 'industrial' | 'park' | 'boundary';

/**
 * Building form — foundation for the zoning generation sprint.
 */
export type ZoneBuildForm =
  | 'block'
  | 'tower'
  | 'random'
  | 'corridor'
  | 'open';

export interface ZoneRect {
  id: string;
  type: ZoneType;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  polygon?: Point2D[];
  name?: string;
  buildForm?: ZoneBuildForm;
  far?: number;
  maxFloors?: number;
  coverage?: number;
  /** Setback from zone boundary / roads (m). Default ~4. */
  setbackM?: number;
  /** Parcel depth from street front for block/corridor (m). */
  parcelDepthM?: number;
  /** Deterministic RNG seed for parcelization. */
  seed?: number;
}

/** Generated massing volume produced by zone generation. */
export interface GeneratedBuilding {
  id: string;
  zoneId: string;
  footprint: Point2D[];
  heightM: number;
  floors: number;
  type: ZoneType;
  buildForm: ZoneBuildForm;
}

export const ZONE_COLORS: Record<ZoneType, string> = {
  residential: '#5ac8fa',
  commercial: '#ffd60a',
  industrial: '#ff9f0a',
  park: '#30d158',
  boundary: '#bf5af2',
};

export const ZONE_LABELS: Record<ZoneType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  park: 'Park',
  boundary: 'Boundary',
};

export const ZONE_BUILD_FORMS: { id: ZoneBuildForm; label: string }[] = [
  { id: 'block', label: 'Block (квартальный)' },
  { id: 'tower', label: 'Tower (точечный)' },
  { id: 'random', label: 'Random' },
  { id: 'corridor', label: 'Corridor' },
  { id: 'open', label: 'Open space' },
];

/** Default zoning metrics by type (Inspector can override). */
export const ZONE_DEFAULTS: Record<
  ZoneType,
  { far: number; coverage: number; maxFloors: number; form: ZoneBuildForm; setbackM: number }
> = {
  residential: { far: 2.0, coverage: 0.45, maxFloors: 8, form: 'block', setbackM: 4 },
  commercial: { far: 3.0, coverage: 0.6, maxFloors: 14, form: 'block', setbackM: 3 },
  industrial: { far: 1.1, coverage: 0.5, maxFloors: 3, form: 'open', setbackM: 6 },
  park: { far: 0, coverage: 0, maxFloors: 0, form: 'open', setbackM: 0 },
  boundary: { far: 0, coverage: 0, maxFloors: 0, form: 'open', setbackM: 0 },
};

export const FLOOR_HEIGHT_M = 3.2;

export function zoneAreaM2(z: ZoneRect): number {
  if (z.polygon && z.polygon.length >= 3) {
    let a = 0;
    const pts = z.polygon;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return Math.abs(a) * 0.5;
  }
  return Math.max(0, z.maxX - z.minX) * Math.max(0, z.maxY - z.minY);
}

export function zoneDisplayName(z: ZoneRect): string {
  if (z.name?.trim()) return z.name.trim();
  if (z.type === 'boundary') return 'Project boundary';
  return ZONE_LABELS[z.type] ?? 'Zone';
}

export function zonePolygon(z: ZoneRect): Point2D[] {
  if (z.polygon && z.polygon.length >= 3) return z.polygon;
  return [
    { x: z.minX, y: z.minY },
    { x: z.maxX, y: z.minY },
    { x: z.maxX, y: z.maxY },
    { x: z.minX, y: z.maxY },
  ];
}

export function resolveZoneParams(z: ZoneRect) {
  const d = ZONE_DEFAULTS[z.type];
  return {
    far: z.far ?? d.far,
    coverage: z.coverage ?? d.coverage,
    maxFloors: z.maxFloors ?? d.maxFloors,
    buildForm: (z.buildForm ?? d.form) as ZoneBuildForm,
    setbackM: z.setbackM ?? d.setbackM,
    parcelDepthM: z.parcelDepthM ?? 28,
    seed: z.seed ?? hashSeed(z.id),
  };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
