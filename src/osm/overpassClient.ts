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

const DEFAULT_TIMEOUT_MS = 25_000;

function buildQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:25];
(
  way["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
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
 * Fetch buildings + highways for a bbox.
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
