import proj4 from 'proj4';
import type { Point2D, SceneOrigin } from '../domain/SceneOrigin';

/**
 * WGS84 → local metres relative to SceneOrigin (UTM).
 * Local X = easting delta, local Y = northing delta (both in metres).
 */

function utmProjString(zone: number, northern: boolean): string {
  const epsg = northern ? 32600 + zone : 32700 + zone;
  const hemisphere = northern ? '+north' : '+south';
  return `+proj=utm +zone=${zone} ${hemisphere} +datum=WGS84 +units=m +no_defs +type=crs /* EPSG:${epsg} */`;
}

const WGS84 = 'EPSG:4326';

export function projectToLocal(
  lat: number,
  lon: number,
  origin: SceneOrigin
): Point2D {
  const utm = utmProjString(origin.utmZone, origin.northern);
  const [originE, originN] = proj4(WGS84, utm, [origin.lon, origin.lat]);
  const [e, n] = proj4(WGS84, utm, [lon, lat]);
  return {
    x: e - originE,
    y: n - originN,
  };
}

export function projectRingToLocal(
  ring: Array<{ lat: number; lon: number }>,
  origin: SceneOrigin
): Point2D[] {
  return ring.map((p) => projectToLocal(p.lat, p.lon, origin));
}
