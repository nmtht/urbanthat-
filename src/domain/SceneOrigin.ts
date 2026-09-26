/**
 * Geographic origin of the local metric scene.
 * Local (0,0) maps to (lat, lon); axes are metres in the chosen UTM zone.
 */
export interface SceneOrigin {
  lat: number;
  lon: number;
  utmZone: number;
  /** Hemisphere for UTM: true = north */
  northern: boolean;
}

export function utmZoneFromLon(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

export function createSceneOrigin(lat: number, lon: number): SceneOrigin {
  return {
    lat,
    lon,
    utmZone: utmZoneFromLon(lon),
    northern: lat >= 0,
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxCenter(bbox: BBox): { lat: number; lon: number } {
  return {
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  };
}

/** Approximate bbox size in metres (rough, for UI limits). */
export function approxBboxSizeM(bbox: BBox): { widthM: number; heightM: number } {
  const midLat = (bbox.south + bbox.north) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return {
    heightM: (bbox.north - bbox.south) * mPerDegLat,
    widthM: (bbox.east - bbox.west) * mPerDegLon,
  };
}
