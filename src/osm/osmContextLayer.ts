import * as THREE from 'three';
import type { OverpassElement, OverpassResponse } from './overpassClient';
import { projectRingToLocal, projectToLocal } from './projection';
import type { SceneOrigin, Point2D, BBox } from '../domain/SceneOrigin';
import { approxBboxSizeM } from '../domain/SceneOrigin';
import {
  offsetPolyline,
  corridorPolygon,
  clipPolygonToRect,
  clipPolylineToRect,
  simplifyPolyline,
  type Rect,
} from '../geometry/polylineOffset';
import { roadProfile, isFootOnly } from './roadDefaults';

const DEFAULT_BUILDING_HEIGHT_M = 9;
const FLOOR_HEIGHT_M = 3.3;

export interface OsmContextMeshes {
  group: THREE.Group;
  buildingCount: number;
  roadCount: number;
  waterCount: number;
  greenCount: number;
  treeCount: number;
  clipRect: Rect;
}

function localToWorld(p: Point2D, yUp = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x, yUp, -p.y);
}

function bboxToLocalRect(bbox: BBox, origin: SceneOrigin, padM = 2): Rect {
  const sw = projectToLocal(bbox.south, bbox.west, origin);
  const ne = projectToLocal(bbox.north, bbox.east, origin);
  return {
    minX: Math.min(sw.x, ne.x) - padM,
    maxX: Math.max(sw.x, ne.x) + padM,
    minY: Math.min(sw.y, ne.y) - padM,
    maxY: Math.max(sw.y, ne.y) + padM,
  };
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

function buildingColors(tags?: Record<string, string>): { wall: THREE.Color; roof: THREE.Color } {
  const t = tags?.building ?? 'yes';
  const palette: Record<string, [string, string]> = {
    apartments: ['#8a8580', '#5c574f'],
    residential: ['#8b857c', '#5e594f'],
    house: ['#9a8f82', '#6b6358'],
    commercial: ['#7a8490', '#4a5360'],
    retail: ['#7d8894', '#4d5662'],
    office: ['#7b8490', '#4a5260'],
    industrial: ['#6e6e6e', '#454545'],
    warehouse: ['#6a6a6a', '#404040'],
    school: ['#8a8078', '#5a544c'],
    church: ['#8c8580', '#4a4540'],
    yes: ['#7d7a76', '#524e4a'],
  };
  const [w, r] = palette[t] ?? palette.yes;
  const wall = new THREE.Color(w);
  const roof = new THREE.Color(r);
  const jitter = ((tags?.name?.length ?? 3) % 7) * 0.008;
  wall.offsetHSL(0, 0, jitter - 0.02);
  return { wall, roof };
}

function ringToShape(ring: Point2D[]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].y);
  shape.closePath();
  return shape;
}

function flatMeshFromRing(ring: Point2D[], yUp: number, mat: THREE.Material): THREE.Mesh | null {
  const shape = ringToShape(ring);
  if (!shape) return null;
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, yUp, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.nonPickable = true;
  return mesh;
}

function wayToLocalRing(el: OverpassElement, origin: SceneOrigin): Point2D[] | null {
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
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'pitch') return true;
  const lu = tags.landuse;
  if (lu === 'grass' || lu === 'forest' || lu === 'meadow' || lu === 'recreation_ground' || lu === 'village_green' || lu === 'orchard') return true;
  if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'grassland') return true;
  return false;
}

function addPolygonMeshes(ring: Point2D[], rect: Rect, yUp: number, mat: THREE.Material, group: THREE.Group): boolean {
  const clipped = clipPolygonToRect(ring, rect);
  if (clipped.length < 3) return false;
  const mesh = flatMeshFromRing(clipped, yUp, mat);
  if (!mesh) return false;
  group.add(mesh);
  return true;
}

function buildRoadPolys(centerline: Point2D[], halfW: number, sidewalk: number): { carriage: Point2D[]; sidewalkOuter: Point2D[] | null } {
  const { left, right } = offsetPolyline(centerline, halfW);
  const carriage = corridorPolygon(left, right);
  if (sidewalk <= 0.05) return { carriage, sidewalkOuter: null };
  const outer = offsetPolyline(centerline, halfW + sidewalk);
  return { carriage, sidewalkOuter: corridorPolygon(outer.left, outer.right) };
}

function dashedCenterLine(centerline: Point2D[], yUp: number, positions: number[]): void {
  const pts = simplifyPolyline(centerline, 0.5);
  const dash = 2.5;
  const gap = 2.0;
  let remaining = 0;
  let drawing = true;
  for (let i = 0; i < pts.length - 1; i++) {
    let a = pts[i];
    const b = pts[i + 1];
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-6) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;
    while (segLen > 1e-6) {
      const need = drawing ? dash - remaining : gap - remaining;
      const step = Math.min(need, segLen);
      const nx = a.x + dx * step;
      const ny = a.y + dy * step;
      if (drawing) {
        const wa = localToWorld(a, yUp);
        const wb = localToWorld({ x: nx, y: ny }, yUp);
        positions.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
      }
      a = { x: nx, y: ny };
      segLen -= step;
      remaining += step;
      const limit = drawing ? dash : gap;
      if (remaining >= limit - 1e-6) {
        remaining = 0;
        drawing = !drawing;
      }
    }
  }
}

export function buildOsmContextLayer(
  data: OverpassResponse,
  origin: SceneOrigin,
  bbox: BBox
): OsmContextMeshes {
  const group = new THREE.Group();
  group.name = 'OsmContextLayer';
  group.userData.nonPickable = true;
  const clipRect = bboxToLocalRect(bbox, origin, 5);
  const size = approxBboxSizeM(bbox);
  const groundSize = Math.max(size.widthM, size.heightM) + 40;

  {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ color: '#3a3a38', roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.userData.nonPickable = true;
    group.add(ground);
  }

  const buildingMats = new Map<string, THREE.MeshStandardMaterial>();
  const getBuildingMat = (hex: string) => {
    let m = buildingMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.88, metalness: 0.05, transparent: true, opacity: 0.92 });
      buildingMats.set(hex, m);
    }
    return m;
  };

  const waterMat = new THREE.MeshStandardMaterial({ color: '#2f5f7a', transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.1, depthWrite: false });
  const greenMat = new THREE.MeshStandardMaterial({ color: '#3f6b48', transparent: true, opacity: 0.75, roughness: 0.92, metalness: 0, depthWrite: false });
  const asphaltMat = new THREE.MeshStandardMaterial({ color: '#2c2c2e', roughness: 0.85, metalness: 0.05 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: '#5a5a58', roughness: 0.9, metalness: 0 });
  const footMat = new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: 0.9, metalness: 0 });

  let buildingCount = 0;
  let roadCount = 0;
  let waterCount = 0;
  let greenCount = 0;
  const treePositions: THREE.Vector3[] = [];
  const lanePositions: number[] = [];

  for (const el of data.elements) {
    if (!el.tags) continue;

    if (el.type === 'node' && el.tags.natural === 'tree') {
      if (el.lat != null && el.lon != null) {
        const p = projectToLocal(el.lat, el.lon, origin);
        if (p.x >= clipRect.minX && p.x <= clipRect.maxX && p.y >= clipRect.minY && p.y <= clipRect.maxY) {
          treePositions.push(localToWorld(p, 0));
        }
      }
      continue;
    }

    if (el.type !== 'way') continue;
    const tags = el.tags;

    if (tags.building) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      const clipped = clipPolygonToRect(ring, clipRect);
      if (clipped.length < 3) continue;
      const shape = ringToShape(clipped);
      if (!shape) continue;
      const height = buildingHeightM(tags);
      const { wall, roof } = buildingColors(tags);
      const geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      geom.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geom, getBuildingMat('#' + wall.getHexString()));
      mesh.userData.nonPickable = true;
      group.add(mesh);
      const roofMesh = flatMeshFromRing(clipped, height + 0.05, getBuildingMat('#' + roof.getHexString()));
      if (roofMesh) group.add(roofMesh);
      buildingCount++;
      continue;
    }

    if (tags.highway) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 2) continue;
      const profile = roadProfile(tags.highway, tags);
      for (const seg of clipPolylineToRect(ring, clipRect)) {
        if (seg.length < 2) continue;
        const half = profile.widthM / 2;
        const { carriage, sidewalkOuter } = buildRoadPolys(seg, half, isFootOnly(tags.highway) ? 0 : profile.sidewalkM);
        const carClipped = clipPolygonToRect(carriage, clipRect);
        if (carClipped.length >= 3) {
          const mesh = flatMeshFromRing(carClipped, 0.04, isFootOnly(tags.highway) ? footMat : asphaltMat);
          if (mesh) { group.add(mesh); roadCount++; }
        }
        if (sidewalkOuter) {
          const sw = clipPolygonToRect(sidewalkOuter, clipRect);
          if (sw.length >= 3) {
            const mesh = flatMeshFromRing(sw, 0.025, sidewalkMat);
            if (mesh) group.add(mesh);
          }
        }
        if (profile.centerLine && profile.lanes >= 2) dashedCenterLine(seg, 0.06, lanePositions);
      }
      continue;
    }

    if (isWater(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      if (addPolygonMeshes(ring, clipRect, 0.01, waterMat, group)) waterCount++;
      continue;
    }

    if (isGreen(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      if (addPolygonMeshes(ring, clipRect, 0.015, greenMat, group)) {
        greenCount++;
        if (ring.length >= 4 && (tags.landuse === 'forest' || tags.natural === 'wood')) {
          const step = Math.max(1, Math.floor(ring.length / 6));
          for (let i = 0; i < ring.length; i += step) {
            const p = ring[i];
            if (p.x >= clipRect.minX && p.x <= clipRect.maxX && p.y >= clipRect.minY && p.y <= clipRect.maxY) {
              treePositions.push(localToWorld(p, 0));
            }
          }
        }
      }
    }
  }

  if (lanePositions.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lanePositions, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c8c4a8', transparent: true, opacity: 0.55 }));
    lines.userData.nonPickable = true;
    group.add(lines);
  }

  const treeCount = Math.min(treePositions.length, 800);
  if (treeCount > 0) {
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.22, 1.2, 5);
    const crownGeom = new THREE.SphereGeometry(1.4, 6, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3728', roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: '#2d5a34', roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, treeCount);
    const crowns = new THREE.InstancedMesh(crownGeom, crownMat, treeCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < treeCount; i++) {
      const p = treePositions[i];
      const scale = 0.7 + (i % 5) * 0.12;
      s.set(scale, scale, scale);
      m.compose(new THREE.Vector3(p.x, 0.6 * scale, p.z), q, s);
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, 1.8 * scale, p.z), q, s);
      crowns.setMatrixAt(i, m);
    }
    trunks.userData.nonPickable = true;
    crowns.userData.nonPickable = true;
    group.add(trunks);
    group.add(crowns);
  }

  return { group, buildingCount, roadCount, waterCount, greenCount, treeCount, clipRect };
}

export function disposeOsmContextLayer(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.InstancedMesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material)?.dispose();
    }
  });
}
