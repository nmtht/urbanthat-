import * as THREE from 'three';
import type { OverpassElement, OverpassResponse } from './overpassClient';
import { projectRingToLocal, projectToLocal } from './projection';
import type { SceneOrigin, Point2D, BBox } from '../domain/SceneOrigin';
import {
  offsetPolyline,
  corridorPolygon,
  clipPolygonToRect,
  clipPolylineToRect,
  simplifyPolyline,
  type Rect,
} from '../geometry/polylineOffset';
import { circlePolygon } from '../geometry/polygonBoolean';
import { roadProfile, isFootOnly } from './roadDefaults';
import {
  facadeStyleFromBuildingTag,
  getFacadeMaterial,
  getRoofMaterial,
  ringPerimeter,
  applyFacadeUVs,
  facadeRepeat,
  type FacadeQuality,
} from '../render/buildingFacades';

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

export interface OsmBuildOptions {
  quality?: FacadeQuality;
  showTrees?: boolean;
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
  // Exclude natural=bay (often huge coastal polygons that flood the scene)
  if (tags.natural === 'water') return true;
  if (tags.waterway === 'riverbank') return true;
  if (tags.landuse === 'reservoir' || tags.landuse === 'basin') return true;
  if (tags.water === 'river' || tags.water === 'oxbow') return true;
  return false;
}

function isGreen(tags: Record<string, string>): boolean {
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'pitch') return true;
  const lu = tags.landuse;
  if (
    lu === 'grass' ||
    lu === 'forest' ||
    lu === 'meadow' ||
    lu === 'recreation_ground' ||
    lu === 'village_green' ||
    lu === 'orchard'
  )
    return true;
  if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'grassland') return true;
  return false;
}

function polygonArea(ring: Point2D[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(a) * 0.5;
}

function isClosedRing(ring: Point2D[], tol = 2.0): boolean {
  if (ring.length < 3) return false;
  const a = ring[0];
  const b = ring[ring.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < tol;
}

function addPolygonMeshes(
  ring: Point2D[],
  rect: Rect,
  yUp: number,
  mat: THREE.Material,
  group: THREE.Group,
  opts?: { maxAreaFrac?: number; requireClosed?: boolean }
): boolean {
  if (opts?.requireClosed && !isClosedRing(ring) && ring.length > 4) {
    // open ring — still try clip, reject if result is huge via maxAreaFrac
  }
  const clipped = clipPolygonToRect(ring, rect);
  if (clipped.length < 3) return false;
  const area = polygonArea(clipped);
  if (area < 4) return false;
  if (opts?.maxAreaFrac != null) {
    const bboxA = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
    if (bboxA > 0 && area / bboxA > opts.maxAreaFrac) {
      // Flood from bad multipolygon / failed clip — skip
      return false;
    }
  }
  const mesh = flatMeshFromRing(clipped, yUp, mat);
  if (!mesh) return false;
  group.add(mesh);
  return true;
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
  bbox: BBox,
  options?: OsmBuildOptions
): OsmContextMeshes {
  const quality = (options?.quality ?? 'med') as FacadeQuality;
  const showTrees = options?.showTrees !== false;
  const group = new THREE.Group();
  group.name = 'OsmContextLayer';
  group.userData.nonPickable = true;
  const clipRect = bboxToLocalRect(bbox, origin, 5);

  const waterMat = new THREE.MeshStandardMaterial({
    color: '#2f5f7a',
    transparent: true,
    opacity: 0.72,
    roughness: 0.25,
    metalness: 0.1,
    depthWrite: false,
  });
  const greenMat = new THREE.MeshStandardMaterial({
    color: '#3f6b48',
    transparent: true,
    opacity: 0.75,
    roughness: 0.92,
    metalness: 0,
    depthWrite: false,
  });
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: '#2c2c2e',
    roughness: 0.85,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: '#5a5a58',
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const footMat = new THREE.MeshStandardMaterial({
    color: '#4a4844',
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });

  let buildingCount = 0;
  let roadCount = 0;
  let waterCount = 0;
  let greenCount = 0;
  const treePositions: THREE.Vector3[] = [];
  const lanePositions: number[] = [];
  const asphaltPolys: Point2D[][] = [];
  const sidewalkPolys: Point2D[][] = [];
  const footPolys: Point2D[][] = [];
  const roadTagSamples: Record<string, string>[] = [];

  for (const el of data.elements) {
    if (!el.tags) continue;

    if (el.type === 'node' && el.tags.natural === 'tree') {
      if (el.lat != null && el.lon != null) {
        const p = projectToLocal(el.lat, el.lon, origin);
        if (
          p.x >= clipRect.minX &&
          p.x <= clipRect.maxX &&
          p.y >= clipRect.minY &&
          p.y <= clipRect.maxY
        ) {
          treePositions.push(localToWorld(p, 0));
        }
      }
      continue;
    }

    if (el.type === 'relation' && el.members) {
      const outers: Point2D[][] = [];
      for (const m of el.members) {
        if (m.role !== 'outer' || m.type !== 'way') continue;
        if (m.geometry && m.geometry.length >= 3) {
          const ring = projectRingToLocal(
            m.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
            origin
          );
          if (ring.length >= 3) outers.push(ring);
          continue;
        }
        const way = data.elements.find((e) => e.type === 'way' && e.id === m.ref);
        if (!way) continue;
        const ring = wayToLocalRing(way, origin);
        if (ring && ring.length >= 3) outers.push(ring);
      }
      if (outers.length === 0) continue;
      if (isWater(el.tags)) {
        for (const ring of outers) {
          if (
            addPolygonMeshes(ring, clipRect, -0.02, waterMat, group, {
              maxAreaFrac: 0.55,
              requireClosed: true,
            })
          )
            waterCount++;
        }
        continue;
      }
      if (isGreen(el.tags)) {
        for (const ring of outers) {
          if (addPolygonMeshes(ring, clipRect, 0.015, greenMat, group)) greenCount++;
        }
        continue;
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
      const style = facadeStyleFromBuildingTag(tags.building);
      const peri = ringPerimeter(clipped);
      const { repU, repV } = facadeRepeat(style, peri, height);
      const geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      applyFacadeUVs(geom, repU, repV);
      geom.rotateX(-Math.PI / 2);
      const wallMat = getFacadeMaterial(style, peri * 0.35, height, quality);
      const mesh = new THREE.Mesh(geom, wallMat);
      mesh.userData.nonPickable = false;
      mesh.userData.osmId = el.id;
      mesh.userData.kind = 'building';
      mesh.userData.osmTags = tags;
      group.add(mesh);
      const roofMesh = flatMeshFromRing(clipped, height + 0.06, getRoofMaterial(style));
      if (roofMesh) {
        roofMesh.userData.nonPickable = true;
        group.add(roofMesh);
      }
      buildingCount++;
      continue;
    }

    if (tags.highway) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 2) continue;
      if (
        quality === 'low' &&
        (isFootOnly(tags.highway) || tags.highway === 'service' || tags.highway === 'track')
      ) {
        continue;
      }
      const profile = roadProfile(tags.highway, tags);
      const foot = isFootOnly(tags.highway);
      for (const seg of clipPolylineToRect(ring, clipRect)) {
        if (seg.length < 2) continue;
        const clean = simplifyPolyline(seg, 0.8);
        if (clean.length < 2) continue;
        const half = profile.widthM / 2;
        // Stable miter offset (roundOffset caused gaps / bowties at joints)
        const { left, right } = offsetPolyline(clean, half, 2.5);
        if (left.length >= 2 && right.length >= 2) {
          const carriage = corridorPolygon(left, right);
          if (carriage.length >= 3 && polygonArea(carriage) > 1) {
            if (foot) footPolys.push(carriage);
            else asphaltPolys.push(carriage);
            roadTagSamples.push(tags);
            roadCount++;
          }
        }
        if (!foot && profile.sidewalkM > 0.4) {
          const { left: l2, right: r2 } = offsetPolyline(clean, half + profile.sidewalkM, 2.5);
          if (l2.length >= 2 && r2.length >= 2) {
            const sw = corridorPolygon(l2, r2);
            if (sw.length >= 3) sidewalkPolys.push(sw);
          }
        }
        if (profile.centerLine && profile.lanes >= 2) dashedCenterLine(clean, 0.08, lanePositions);
        // Junction pads at EVERY vertex — closes T-junctions / corners
        if (!foot) {
          for (const pt of clean) {
            asphaltPolys.push(circlePolygon(pt.x, pt.y, half * 1.15, 14));
          }
        }
      }
      continue;
    }

    if (isWater(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      if (
        addPolygonMeshes(ring, clipRect, -0.02, waterMat, group, {
          maxAreaFrac: 0.55,
          requireClosed: true,
        })
      )
        waterCount++;
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
            if (
              p.x >= clipRect.minX &&
              p.x <= clipRect.maxX &&
              p.y >= clipRect.minY &&
              p.y <= clipRect.maxY
            ) {
              treePositions.push(localToWorld(p, 0));
            }
          }
        }
      }
    }
  }

  for (let i = 0; i < asphaltPolys.length; i++) {
    const mesh = flatMeshFromRing(asphaltPolys[i], 0.05, asphaltMat);
    if (mesh) {
      mesh.userData.kind = 'road';
      mesh.userData.osmTags = roadTagSamples[i] ?? roadTagSamples[0] ?? { highway: 'residential' };
      mesh.userData.nonPickable = false;
      group.add(mesh);
    }
  }
  for (const poly of sidewalkPolys) {
    const mesh = flatMeshFromRing(poly, 0.02, sidewalkMat);
    if (mesh) group.add(mesh);
  }
  for (const poly of footPolys) {
    const mesh = flatMeshFromRing(poly, 0.04, footMat);
    if (mesh) {
      mesh.userData.kind = 'road';
      mesh.userData.osmTags = { highway: 'footway' };
      mesh.userData.nonPickable = false;
      group.add(mesh);
    }
  }

  if (lanePositions.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lanePositions, 3));
    const lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: '#c8c4a8', transparent: true, opacity: 0.55 })
    );
    lines.userData.nonPickable = true;
    group.add(lines);
  }

  const treeCount = showTrees ? Math.min(treePositions.length, 800) : 0;
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
    trunks.userData.kind = 'tree';
    crowns.userData.nonPickable = true;
    crowns.userData.kind = 'tree';
    group.add(trunks);
    group.add(crowns);
  }

  return { group, buildingCount, roadCount, waterCount, greenCount, treeCount, clipRect };
}

export function disposeOsmContextLayer(group: THREE.Group): void {
  group.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.InstancedMesh
    ) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material)?.dispose();
    }
  });
}
