/**
 * Polygon union for road corridors.
 * Pure-TS implementation (Clipper2 WASM optional later — dynamic import broke Vite).
 */
import type { Point2D } from '../domain/SceneOrigin';
import { unionPolygons, circlePolygon, type Pt } from './polygonBoolean';

/**
 * Union road carriage polygons via pure-TS convex-hull merge of overlapping corridors.
 */
export function unionPolygonsSafe(polys: Point2D[][]): Point2D[][] {
  if (polys.length === 0) return [];
  if (polys.length === 1) return [polys[0]];
  return unionPolygons(polys as Pt[][]) as Point2D[][];
}

/** No-op: Clipper WASM deferred (Vite + clipper2-wasm 0.0.1 incompat). */
export function ensureClipper(): Promise<boolean> {
  return Promise.resolve(false);
}

/** Circular hub pad at a junction. */
export function hubPad(cx: number, cy: number, radiusM: number, segments = 20): Point2D[] {
  return circlePolygon(cx, cy, radiusM, segments) as Point2D[];
}
