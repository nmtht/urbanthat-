/**
 * Polygon union for road corridors.
 * Tries clipper2-wasm when available; falls back to pure-TS union + hub pads.
 */
import type { Point2D } from '../domain/SceneOrigin';
import { unionPolygons, circlePolygon, type Pt } from './polygonBoolean';

const SCALE = 1000;

let clipperModule: any = null;
let clipperTried = false;
let clipperFailed = false;

async function tryLoadClipper(): Promise<boolean> {
  if (clipperModule) return true;
  if (clipperFailed || clipperTried) return !!clipperModule;
  clipperTried = true;
  try {
    const mod = await import('clipper2-wasm');
    const factory =
      (mod as any).default ??
      (mod as any).Clipper2ZFactory ??
      (mod as any).Clipper2Factory ??
      mod;
    if (typeof factory === 'function') {
      clipperModule = await factory({
        locateFile: (path: string) => {
          try {
            return new URL(`clipper2-wasm/dist/${path}`, import.meta.url).href;
          } catch {
            return path;
          }
        },
      });
    } else if ((mod as any).CreateClipper64 || (mod as any).Clipper) {
      clipperModule = mod;
    }
    return !!clipperModule;
  } catch {
    clipperFailed = true;
    if (!(globalThis as any).__clipperLogged) {
      (globalThis as any).__clipperLogged = true;
      console.info('[Urban That] clipper2-wasm unavailable — using pure-TS union fallback');
    }
    return false;
  }
}

function toIntPath(poly: Point2D[]): Array<{ x: number; y: number }> {
  return poly.map((p) => ({
    x: Math.round(p.x * SCALE),
    y: Math.round(p.y * SCALE),
  }));
}

function unionWithClipper(polys: Point2D[][]): Point2D[][] | null {
  if (!clipperModule || polys.length === 0) return null;
  try {
    const lib = clipperModule;
    if (typeof lib.CreateClipper64 === 'function') {
      const clipper2 = new lib.CreateClipper64(false);
      for (const poly of polys) {
        const path = toIntPath(poly);
        const p64 = new lib.Path64();
        for (const pt of path) p64.push_back(new lib.Point64(pt.x, pt.y));
        clipper2.AddSubjectPath(p64, true);
      }
      const result = new lib.Paths64();
      const ok = clipper2.ExecutePath(
        lib.ClipType?.Union ?? 1,
        lib.FillRule?.NonZero ?? 1,
        result
      );
      clipper2.delete?.();
      if (!ok) return null;
      const outPolys: Point2D[][] = [];
      const n = result.size?.() ?? result.length ?? 0;
      for (let i = 0; i < n; i++) {
        const path = result.get?.(i) ?? result[i];
        const pts: Point2D[] = [];
        const m = path.size?.() ?? path.length ?? 0;
        for (let j = 0; j < m; j++) {
          const pt = path.get?.(j) ?? path[j];
          pts.push({ x: Number(pt.x) / SCALE, y: Number(pt.y) / SCALE });
        }
        if (pts.length >= 3) outPolys.push(pts);
      }
      result.delete?.();
      return outPolys.length ? outPolys : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Union road carriage polygons. Prefer Clipper2; fallback pure-TS. */
export function unionPolygonsSafe(polys: Point2D[][]): Point2D[][] {
  if (polys.length === 0) return [];
  if (polys.length === 1) return [polys[0]];

  if (clipperModule) {
    const via = unionWithClipper(polys);
    if (via && via.length > 0) return via;
  }

  return unionPolygons(polys as Pt[][]) as Point2D[][];
}

/** Kick off optional WASM load (non-blocking). */
export function ensureClipper(): Promise<boolean> {
  return tryLoadClipper();
}

/** Circular hub pad at a junction. */
export function hubPad(cx: number, cy: number, radiusM: number, segments = 20): Point2D[] {
  return circlePolygon(cx, cy, radiusM, segments) as Point2D[];
}
