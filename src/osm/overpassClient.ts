import type { BBox } from '../domain/SceneOrigin';

export interface OverpassNodeGeom {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type: 'way' | 'node' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNodeGeom[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.openstreetmap.fr/api/interpreter',
];

const DEFAULT_TIMEOUT_MS = 30_000;

function buildQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  const bb = `${south},${west},${north},${east}`;
  // Buildings, roads, water, greenery (ways with geometry).
  // Relations/multipolygons omitted for MVP simplicity.
  return `
[out:json][timeout:30];
(
  way["building"](${bb});
  way["highway"](${bb});
  way["natural"="water"](${bb});
  way["waterway"="riverbank"](${bb});
  way["landuse"="reservoir"](${bb});
  way["landuse"="basin"](${bb});
  way["natural"="bay"](${bb});
  way["leisure"="park"](${bb});
  way["leisure"="garden"](${bb});
  way["leisure"="pitch"](${bb});
  way["landuse"="grass"](${bb});
  way["landuse"="forest"](${bb});
  way["landuse"="meadow"](${bb});
  way["landuse"="recreation_ground"](${bb});
  way["landuse"="village_green"](${bb});
  way["landuse"="orchard"](${bb});
  way["natural"="wood"](${bb});
  way["natural"="scrub"](${bb});
  way["natural"="grassland"](${bb});
);
out geom;
`.trim();
}

export class OverpassError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

/**
 * Fetch buildings, highways, water and greenery for a bbox.
 * Tries endpoints in order until one succeeds.
 */
export async function fetchOsmFragment(
  bbox: BBox,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<OverpassResponse> {
  const query = buildQuery(bbox);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort);

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        lastError = new OverpassError(
          `Overpass HTTP ${res.status}`,
          res.status,
          endpoint
        );
        continue;
      }

      const data = (await res.json()) as OverpassResponse;
      if (!data.elements) {
        lastError = new OverpassError('Invalid Overpass response', undefined, endpoint);
        continue;
      }
      return data;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new OverpassError('Request timed out or aborted', undefined, endpoint);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError ?? new OverpassError('All Overpass endpoints failed');
}
