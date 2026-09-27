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

function flatMeshFromRing(
  ring: Point2D[],
  yUp: number,
  mat: THREE.Material,
  holes?: Point2D[][]
): THREE.Mesh | null {
  const shape = ringToShape(ring);
  if (!shape) return null;
  if (holes) {
    for (const h of holes) {
      if (h.length < 3) continue;
      const path = new THREE.Path();
      path.moveTo(h[0].x, h[0].y);
      for (let i = 1; i < h.length; i++) path.lineTo(h[i].x, h[i].y);
      path.closePath();
      shape.holes.push(path);
    }
  }
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, yUp, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.nonPickable = true;
  return mesh;
}

function pointInPoly(px: number, py: number, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x,
      yi = ring[i].y;
    const xj = ring[j].x,
      yj = ring[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBBoxAspect(ring: Point2D[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 1 || h < 1) return 1;
  return Math.max(w / h, h / w);
}

function wayToLocalRing(el: OverpassElement, origin: SceneOrigin): Point2D[] | null {
  if (!el.geometry || el.geometry.length < 2) return null;
  return projectRingToLocal(
    el.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
    origin
  );
}

function isWater(tags: Record<string, string>): boolean {
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

function ringTouchesRect(ring: Point2D[], rect: Rect, pad = 30): boolean {
  const r = {
    minX: rect.minX - pad,
    maxX: rect.maxX + pad,
    minY: rect.minY - pad,
    maxY: rect.maxY + pad,
  };
  let inside = 0;
  for (const p of ring) {
    if (p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY) inside++;
  }
  if (inside > 0) return true;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const contains =
    minX < rect.minX && maxX > rect.maxX && minY < rect.minY && maxY > rect.maxY;
  if (contains) return false;
  const overlaps =
    !(maxX < rect.minX || minX > rect.maxX || maxY < rect.minY || minY > rect.maxY);
  return overlaps;
}

function isAlmostBBox(poly: Point2D[], rect: Rect, frac = 0.92): boolean {
  const a = polygonArea(poly);
  const bboxA = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
  if (bboxA <= 0) return false;
  return a / bboxA >= frac;
}

function addPolygonMeshes(
  ring: Point2D[],
  rect: Rect,
  yUp: number,
  mat: THREE.Material,
  group: THREE.Group,
  opts?: {
    maxAreaFrac?: number;
    requireTouch?: boolean;
    holes?: Point2D[][];
    elongatedMaxFrac?: number;
  }
): boolean {
  if (opts?.requireTouch !== false && !ringTouchesRect(ring, rect)) {
    return false;
  }
  const clipped = clipPolygonToRect(ring, rect);
  if (clipped.length < 3) return false;
  const area = polygonArea(clipped);
  if (area < 8) return false;
  if (isAlmostBBox(clipped, rect, 0.88)) return false;
  if (opts?.maxAreaFrac != null) {
    const bboxA = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
    const frac = bboxA > 0 ? area / bboxA : 1;
    const aspect = ringBBoxAspect(clipped);
    const limit =
      aspect >= 3 && opts.elongatedMaxFrac != null ? opts.elongatedMaxFrac : opts.maxAreaFrac;
    if (frac > limit) return false;
  }
  const clippedHoles: Point2D[][] = [];
  if (opts?.holes) {
    for (const h of opts.holes) {
      const ch = clipPolygonToRect(h, rect);
      if (ch.length >= 3 && polygonArea(ch) > 4) clippedHoles.push(ch);
    }
  }
  const mesh = flatMeshFromRing(
    clipped,
    yUp,
    mat,
    clippedHoles.length ? clippedHoles : undefined
  );
  if (!mesh) return false;
  mesh.userData.localRing = clipped;
  mesh.userData.localHoles = clippedHoles;
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
  const asphaltPads: Point2D[][] = [];
  const footPolys: Point2D[][] = [];
  const roadTagSamples: Record<string, string>[] = [];
  const buildingCentroids: Point2D[] = [];

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
      const inners: Point2D[][] = [];
      for (const m of el.members) {
        if (m.type !== 'way') continue;
        if (m.role !== 'outer' && m.role !== 'inner') continue;
        let ring: Point2D[] | null = null;
        if (m.geometry && m.geometry.length >= 3) {
          ring = projectRingToLocal(
            m.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
            origin
          );
        } else {
          const way = data.elements.find((e) => e.type === 'way' && e.id === m.ref);
          if (way) ring = wayToLocalRing(way, origin);
        }
        if (!ring || ring.length < 3) continue;
        if (m.role === 'outer') outers.push(ring);
        else inners.push(ring);
      }
      if (outers.length === 0) continue;
      if (isWater(el.tags)) {
        for (const ring of outers) {
          if (
            addPolygonMeshes(ring, clipRect, -0.02, waterMat, group, {
              maxAreaFrac: 0.4,
              elongatedMaxFrac: 0.65,
              requireTouch: true,
              holes: inners,
            })
          )
            waterCount++;
        }
        continue;
      }
      if (isGreen(el.tags)) {
        for (const ring of outers) {
          if (
            addPolygonMeshes(ring, clipRect, 0.015, greenMat, group, {
              requireTouch: false,
              holes: inners,
            })
          )
            greenCount++;
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
      mesh.name = 'building-wall';

      const bldg = new THREE.Group();
      bldg.name = `building-${el.id}`;
      bldg.userData.nonPickable = false;
      bldg.userData.osmId = el.id;
      bldg.userData.kind = 'building';
      bldg.userData.osmTags = tags;
      bldg.add(mesh);

      const roofMesh = flatMeshFromRing(clipped, height + 0.06, getRoofMaterial(style));
      if (roofMesh) {
        roofMesh.name = 'building-roof';
        roofMesh.userData.nonPickable = true;
        roofMesh.userData.kind = 'building';
        roofMesh.userData.osmId = el.id;
        bldg.add(roofMesh);
      }
      group.add(bldg);
      {
        let cx = 0,
          cy = 0;
        for (const p of clipped) {
          cx += p.x;
          cy += p.y;
        }
        cx /= clipped.length;
        cy /= clipped.length;
        buildingCentroids.push({ x: cx, y: cy });
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
        if (profile.centerLine && profile.lanes >= 2) dashedCenterLine(clean, 0.08, lanePositions);
        if (!foot) {
          for (const pt of clean) {
            asphaltPads.push(circlePolygon(pt.x, pt.y, half * 1.15, 14));
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
          maxAreaFrac: 0.4,
          elongatedMaxFrac: 0.65,
          requireTouch: true,
        })
      )
        waterCount++;
      continue;
    }

    if (isGreen(tags)) {
      const ring = wayToLocalRing(el, origin);
      if (!ring || ring.length < 3) continue;
      if (addPolygonMeshes(ring, clipRect, 0.015, greenMat, group, { requireTouch: false })) {
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

  // Drop water that floods building blocks (clip artifact / missing multipolygon holes)
  const toRemove: THREE.Object3D[] = [];
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const mat = child.material as THREE.MeshStandardMaterial;
    if (!mat?.color || mat.color.getHexString() !== '2f5f7a') continue;
    const ring = child.userData.localRing as Point2D[] | undefined;
    const holes = (child.userData.localHoles as Point2D[][] | undefined) ?? [];
    let inside = 0;
    for (const c of buildingCentroids) {
      let hit: boolean;
      if (ring) {
        // Actual polygon containment (holes carved out), not the bounding box —
        // an elongated/rotated river's AABB is much larger than its real shape
        // and was flagging unrelated buildings as "flooded".
        hit = pointInPoly(c.x, c.y, ring) && !holes.some((h) => pointInPoly(c.x, c.y, h));
      } else {
        const box = new THREE.Box3().setFromObject(child);
        const wx = c.x;
        const wz = -c.y;
        hit = wx >= box.min.x && wx <= box.max.x && wz >= box.min.z && wz <= box.max.z;
      }
      if (hit) inside++;
    }
    if (buildingCentroids.length > 0 && inside / buildingCentroids.length > 0.12) {
      toRemove.push(child);
    }
  }
  for (const obj of toRemove) {
    group.remove(obj);
    (obj as THREE.Mesh).geometry?.dispose();
    waterCount = Math.max(0, waterCount - 1);
  }

  for (let i = 0; i < asphaltPolys.length; i++) {
    const mesh = flatMeshFromRing(asphaltPolys[i], 0.05, asphaltMat);
    if (mesh) {
      mesh.userData.kind = 'road';
      mesh.userData.osmTags = roadTagSamples[i] ?? { highway: 'residential' };
      mesh.userData.nonPickable = false;
      mesh.userData.osmId = `road-${i}`;
      group.add(mesh);
    }
  }
  for (const poly of asphaltPads) {
    const mesh = flatMeshFromRing(poly, 0.05, asphaltMat);
    if (mesh) {
      mesh.userData.nonPickable = true;
      mesh.userData.kind = 'road-pad';
      group.add(mesh);
    }
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
    const crownMat = new THREE.MeshStandardMaterial({ color: '#2d5a32', roughness: 0.85 });
    for (let i = 0; i < treeCount; i++) {
      const pos = treePositions[i];
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.set(pos.x, 0.6, pos.z);
      trunk.userData.kind = 'tree';
      trunk.userData.nonPickable = true;
      group.add(trunk);
      const crown = new THREE.Mesh(crownGeom, crownMat);
      crown.position.set(pos.x, 2.2, pos.z);
      crown.userData.kind = 'tree';
      crown.userData.nonPickable = true;
      group.add(crown);
    }
  }

  return {
    group,
    buildingCount,
    roadCount,
    waterCount,
    greenCount,
    treeCount,
    clipRect,
  };
}

export function disposeOsmContextLayer(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material)?.dispose();
    }
  });
}
