import * as THREE from 'three';
import type { OverpassElement, OverpassResponse } from './overpassClient';
import { projectRingToLocal } from './projection';
import type { SceneOrigin, Point2D } from '../domain/SceneOrigin';

const DEFAULT_BUILDING_HEIGHT_M = 9;
const FLOOR_HEIGHT_M = 3.3;

const BUILDING_COLOR = new THREE.Color('#5a5a5e');
const BUILDING_OPACITY = 0.45;
const ROAD_COLOR = new THREE.Color('#3d3d42');
const WATER_COLOR = new THREE.Color('#3a5f7a');
const GREEN_COLOR = new THREE.Color('#3d5c45');

export interface OsmContextMeshes {
  group: THREE.Group;
  buildingCount: number;
  roadCount: number;
  waterCount: number;
  greenCount: number;
}

/**
 * Local metric (easting, northing) → Three.js world.
 * Must match ExtrudeGeometry + rotateX(-PI/2):
 *   shape (x, y) → world (x, height, -y)
 * so roads / flat polygons use the same mapping.
 */
function localToWorld(p: Point2D, yUp = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x, yUp, -p.y);
}

function parseLevels(tags?: Record<string, string>): number | null {
  if (!tags) return null;
  if (tags['building:levels']) {
    const n = parseFloat(tags['building:levels']);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (tags.height) {
    const h = parseFloat(tags.height.replace(/m$/i, '').trim());
    if (!Number.isNaN(h) && h > 0) return h / FLOOR_HEIGHT_M;
  }
  return null;
}

function buildingHeightM(tags?: Record<string, string>): number {
  const levels = parseLevels(tags);
  if (levels != null) return Math.min(levels * FLOOR_HEIGHT_M, 120);
  return DEFAULT_BUILDING_HEIGHT_M;
}

/**
 * Shape in the plane that ExtrudeGeometry expects BEFORE rotateX(-PI/2).
 * shape.x = local easting, shape.y = local northing.
 * After rotateX(-PI/2): world (x, z) = (easting, -northing).
 */
function ringToShape(ring: Point2D[]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) {
    shape.lineTo(ring[i].x, ring[i].y);
  }
  shape.closePath();
  return shape;
}

/**
 * Flat horizontal polygon on the ground (water / green).
 * Vertices use the same localToWorld mapping as roads and buildings.
 */
function ringToFlatGeometry(ring: Point2D[], yUp: number): THREE.BufferGeometry | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  // Build shape already in world XZ via (x, -y) so ShapeGeometry lies in XY
  // then we rotate it the same way as buildings.
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) {
    shape.lineTo(ring[i].x, ring[i].y);
  }
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, yUp, 0);
  return geom;
}

function wayToLocalRing(
  el: OverpassElement,
  origin: SceneOrigin
): Point2D[] | null {
  if (!el.geometry || el.geometry.length < 2) return null;
  return projectRingToLocal(
    el.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
    origin
  );
}

function isWater(tags: Record<string, string>): boolean {
  if (tags.natural === 'water' || tags.natural === 'bay') return true;
  if (tags.waterway === 'riverbank') return true;
  if (tags.landuse === 'reservoir' || tags.landuse === 'basin') return true;
  return false;
}

function isGreen(tags: Record<string, string>): boolean {
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'pitch') {
    return true;
  }
  const lu = tags.landuse;
  if (
    lu === 'grass' ||
    lu === 'forest' ||
    lu === 'meadow' ||
    lu === 'recreation_ground' ||
    lu === 'village_green' ||
    lu === 'orchard'
  ) {
    return true;
  }
  if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'grassland') {
    return true;
  }
  return false;
}

/**
 * Build a non-interactive Three.js group from Overpass data.
 */
export function buildOsmContextLayer(
  data: OverpassResponse,
  origin: SceneOrigin
): OsmContextMeshes {
  const group = new THREE.Group();
  group.name = 'OsmContextLayer';
  group.userData.nonPickable = true;

  const buildingMat = new THREE.MeshStandardMaterial({
    color: BUILDING_COLOR,
    transparent: true,
    opacity: BUILDING_OPACITY,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
  });

  const waterMat = new THREE.MeshStandardMaterial({
    color: WATER_COLOR,
    transparent: true,
    opacity: 0.55,
    roughness: 0.35,
    metalness: 0.05,
    depthWrite: false,
  });

  const greenMat = new THREE.MeshStandardMaterial({
    color: GREEN_COLOR,
    transparent: true,
    opacity: 0.5,
    roughness: 0.95,
    metalness: 0,
    depthWrite: false,
  });

  let buildingCount = 0;
  let roadCount = 0;
  let waterCount = 0;
  let greenCount = 0;

  const roadPositions: number[] = [];

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags) continue;
    const tags = el.tags;

    if (tags.building) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      const shape = ringToShape(ring);
      if (!shape) continue;

      const height = buildingHeightM(tags);
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });
      // shape (x,y) → world (x, z=-y) with +Y up
      geom.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geom, buildingMat);
      mesh.userData.nonPickable = true;
      mesh.userData.osmId = el.id;
      group.add(mesh);
      buildingCount++;
      continue;
    }

    if (tags.highway) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = localToWorld(ring[i], 0.08);
        const b = localToWorld(ring[i + 1], 0.08);
        roadPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      roadCount++;
      continue;
    }

    if (isWater(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      const geom = ringToFlatGeometry(ring, 0.02);
      if (!geom) continue;
      const mesh = new THREE.Mesh(geom, waterMat);
      mesh.userData.nonPickable = true;
      mesh.userData.osmId = el.id;
      group.add(mesh);
      waterCount++;
      continue;
    }

    if (isGreen(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      const geom = ringToFlatGeometry(ring, 0.03);
      if (!geom) continue;
      const mesh = new THREE.Mesh(geom, greenMat);
      mesh.userData.nonPickable = true;
      mesh.userData.osmId = el.id;
      group.add(mesh);
      greenCount++;
    }
  }

  if (roadPositions.length > 0) {
    const roadGeom = new THREE.BufferGeometry();
    roadGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(roadPositions, 3)
    );
    const roadMat = new THREE.LineBasicMaterial({
      color: ROAD_COLOR,
      transparent: true,
      opacity: 0.75,
    });
    const lines = new THREE.LineSegments(roadGeom, roadMat);
    lines.userData.nonPickable = true;
    group.add(lines);
  }

  return { group, buildingCount, roadCount, waterCount, greenCount };
}

export function disposeOsmContextLayer(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}
