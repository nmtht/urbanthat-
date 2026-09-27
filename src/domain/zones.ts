import type { Point2D } from './SceneOrigin';

export type ZoneType = 'residential' | 'commercial' | 'industrial' | 'park';

/** Axis-aligned rectangle zone (legacy + rect mode). */
export interface ZoneRect {
  id: string;
  type: ZoneType;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Optional polygon outline in local XY (polygon / freehand modes). */
  polygon?: Point2D[];
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
