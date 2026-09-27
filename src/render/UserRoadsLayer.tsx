import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoadCenterline } from '../domain/roads';
import type { FacadeQuality } from './buildingFacades';
import { buildNetworkGeometry, localToWorld } from '../geometry/roadBuild';

interface Props {
  roads: RoadCenterline[];
  quality?: FacadeQuality;
  hour?: number;
}

function ringToShape(ring: { x: number; y: number }[]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const clean: { x: number; y: number }[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i];
    const prev = clean[clean.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) clean.push(p);
  }
  if (clean.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(clean[0].x, clean[0].y);
  for (let i = 1; i < clean.length; i++) shape.lineTo(clean[i].x, clean[i].y);
  shape.closePath();
  return shape;
}

function meshFromRing(
  ring: { x: number; y: number }[],
  yUp: number,
  mat: THREE.Material,
  userData: Record<string, unknown>
): THREE.Mesh | null {
  const shape = ringToShape(ring);
  if (!shape) return null;
  try {
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, yUp, 0);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = userData;
    return mesh;
  } catch {
    return null;
  }
}

function sampleLamps(pts: { x: number; y: number }[], spacing = 28): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (pts.length < 2) return out;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t < seg) {
      if (acc + t >= spacing) {
        const f = t / seg;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        acc = 0;
      }
      const step = Math.min(spacing - acc, seg - t);
      t += step;
      acc += step;
    }
  }
  return out;
}

export function UserRoadsLayer({ roads, quality = 'med', hour = 14 }: Props) {
  const { scene } = useThree();

  useEffect(() => {
    let group = scene.getObjectByName('UserRoadsLayer') as THREE.Group | undefined;
    if (!group) {
      group = new THREE.Group();
      group.name = 'UserRoadsLayer';
      scene.add(group);
    }

    while (group.children.length) {
      const c = group.children[0];
      group.remove(c);
      c.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry?.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material)?.dispose?.();
        }
      });
    }

    const { roads: network, hubs } = buildNetworkGeometry(roads);

    if (hubs.length > 0) {
      const hubMat = new THREE.MeshStandardMaterial({
        color: '#2c2c2e',
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      for (const hub of hubs) {
        const mesh = meshFromRing(hub, 0.055, hubMat, {
          kind: 'user-road-hub',
          nonPickable: true,
        });
        if (mesh) group.add(mesh);
      }
    }

    const lampPts: { x: number; y: number }[] = [];

    for (const g of network) {
      const addStrips = (
        polys: { x: number; y: number }[][],
        color: string,
        y: number,
        kind: string
      ) => {
        if (!polys.length) return;
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          metalness: 0,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 2,
          polygonOffsetUnits: 2,
        });
        for (const poly of polys) {
          const mesh = meshFromRing(poly, y, mat, {
            kind,
            roadId: g.id,
            nonPickable: true,
          });
          if (mesh) group.add(mesh);
        }
      };

      addStrips(g.greenPolys, '#3d5c3a', 0.03, 'user-road-green');
      addStrips(g.parkingPolys, '#3a3a38', 0.04, 'user-road-parking');
      addStrips(g.sidewalkPolys, '#4a4846', 0.045, 'user-road-sidewalk');

      const asphaltMat = new THREE.MeshStandardMaterial({
        color: g.profile.asphaltColor,
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      const mesh = meshFromRing(g.carriagePoly, 0.06, asphaltMat, {
        kind: 'user-road',
        roadId: g.id,
        nonPickable: false,
        osmTags: { highway: g.profile.id, name: g.profile.label },
      });
      if (mesh) {
        mesh.name = `user-road-${g.id}`;
        group.add(mesh);
      }

      if (quality !== 'low' && g.markingSegments.length > 0) {
        const positions: number[] = [];
        for (const seg of g.markingSegments) {
          if (seg.length < 2) continue;
          const a = localToWorld(seg[0], 0.09);
          const b = localToWorld(seg[1], 0.09);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        if (positions.length >= 6) {
          const lg = new THREE.BufferGeometry();
          lg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const lines = new THREE.LineSegments(
            lg,
            new THREE.LineBasicMaterial({
              color: g.profile.markingColor,
              transparent: true,
              opacity: 0.55,
            })
          );
          lines.userData = { kind: 'user-road-marking', nonPickable: true };
          group.add(lines);
        }
      }

      if (quality === 'high') {
        const road = roads.find((r) => r.id === g.id);
        if (road && road.points.length >= 2) {
          lampPts.push(...sampleLamps(road.points, 28));
        }
      }
    }

    if (quality === 'high' && lampPts.length > 0) {
      const maxLamps = Math.min(lampPts.length, 80);
      const poleGeom = new THREE.CylinderGeometry(0.06, 0.08, 5.5, 5);
      const headGeom = new THREE.SphereGeometry(0.22, 6, 5);
      const poleMat = new THREE.MeshStandardMaterial({
        color: '#2a2a2c',
        roughness: 0.7,
        metalness: 0.4,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: '#f5e6c8',
        emissive: new THREE.Color('#ffc878'),
        emissiveIntensity: 0.35,
        roughness: 0.4,
      });
      const lampGroup = new THREE.Group();
      lampGroup.name = 'UserStreetLamps';
      lampGroup.userData.kind = 'street-lamps';
      for (let i = 0; i < maxLamps; i++) {
        const p = lampPts[i];
        const w = localToWorld(p, 0);
        const pole = new THREE.Mesh(poleGeom, poleMat);
        pole.position.set(w.x, 2.75, w.z);
        pole.userData.nonPickable = true;
        lampGroup.add(pole);
        const head = new THREE.Mesh(headGeom, headMat.clone());
        head.position.set(w.x, 5.6, w.z);
        head.userData.nonPickable = true;
        head.userData.kind = 'street-lamp-head';
        lampGroup.add(head);
        const light = new THREE.PointLight('#ffc878', 0.0, 28, 2);
        light.position.set(w.x, 5.4, w.z);
        light.userData.kind = 'street-lamp-light';
        light.userData.baseIntensity = 1.2;
        lampGroup.add(light);
      }
      group.add(lampGroup);
    }
  }, [roads, quality, scene]);

  useEffect(() => {
    const group = scene.getObjectByName('UserRoadsLayer') as THREE.Group | undefined;
    if (!group) return;
    let night = 0;
    if (hour <= 5.5 || hour >= 21) night = 1;
    else if (hour < 7.5) night = 1 - (hour - 5.5) / 2.0;
    else if (hour > 18.5) night = (hour - 18.5) / 2.5;
    night = Math.max(0, Math.min(1, night));
    night = night * night * (3 - 2 * night);
    group.traverse((obj) => {
      if (obj.userData?.kind === 'street-lamp-light' && obj instanceof THREE.PointLight) {
        const base = (obj.userData.baseIntensity as number) ?? 1.2;
        obj.intensity = base * night;
      }
      if (obj.userData?.kind === 'street-lamp-head' && obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat?.emissiveIntensity != null) mat.emissiveIntensity = 0.15 + night * 0.85;
      }
    });
  }, [hour, roads, quality, scene]);

  return null;
}
