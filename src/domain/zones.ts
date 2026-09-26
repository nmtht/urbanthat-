export type ZoneType = 'residential' | 'commercial' | 'industrial' | 'park';

export interface ZoneRect {
  id: string;
  type: ZoneType;
  /** Local metric XY (same as OSM layer). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const ZONE_COLORS: Record<ZoneType, string> = {
  residential: '#5ac8fa',
  commercial: '#ffd60a',
  industrial: '#ff9f0a',
  park: '#30d158',
};

export const ZONE_LABELS: Record<ZoneType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  park: 'Park',
};
