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
