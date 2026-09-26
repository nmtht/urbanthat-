import * as THREE from 'three';
import type { OverpassElement, OverpassResponse } from './overpassClient';
import { projectRingToLocal } from './projection';
import type { SceneOrigin, Point2D } from '../domain/SceneOrigin';

const DEFAULT_BUILDING_HEIGHT_M = 9; // ~3 floors
const FLOOR_HEIGHT_M = 3.3;

const BUILDING_COLOR = new THREE.Color('#5a5a5e');
const BUILDING_OPACITY = 0.45;
const ROAD_COLOR = new THREE.Color('#3d3d42');

export interface OsmContextMeshes {
  group: THREE.Group;
  buildingCount: number;
  roadCount: number;
}

function parseLevels(tags?: Record<string, string>): number | null {
  if (!tags) return null;
  if (tags['building:levels']) {
    const n = parseFloat(tags['building:levels']);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!Number.isNaN(h) && h > 0) return h / FLOOR_HEIGHT_M;
  }
  return null;
}

function buildingHeightM(tags?: Record<string, string>): number {
  const levels = parseLevels(tags);
  if (levels != null) return Math.min(levels * FLOOR_HEIGHT_M, 120);
  return DEFAULT_BUILDING_HEIGHT_M;
}

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

/**
 * Build a non-interactive Three.js group from Overpass data.
 * Buildings: extruded, muted, semi-transparent.
 * Highways: simple line segments (background context only).
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

  let buildingCount = 0;
  let roadCount = 0;

  const roadPositions: number[] = [];

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags) continue;

    if (el.tags.building) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      const shape = ringToShape(ring);
      if (!shape) continue;

      const height = buildingHeightM(el.tags);
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });
      geom.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geom, buildingMat);
      mesh.userData.nonPickable = true;
      mesh.userData.osmId = el.id;
      group.add(mesh);
      buildingCount++;
    } else if (el.tags.highway) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        roadPositions.push(ring[i].x, 0.05, ring[i].y);
        roadPositions.push(ring[i + 1].x, 0.05, ring[i + 1].y);
      }
      roadCount++;
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
      opacity: 0.7,
    });
    const lines = new THREE.LineSegments(roadGeom, roadMat);
    lines.userData.nonPickable = true;
    group.add(lines);
  }

  return { group, buildingCount, roadCount };
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
