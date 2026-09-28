/**
 * Renders zone courtyards: green ground patches + simple tree instances.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { ZoneCourtyard } from '../domain/zones';

interface Props {
  courtyards: ZoneCourtyard[];
}

const GREEN: Record<ZoneCourtyard['kind'], string> = {
  court: '#5a9e6e',
  plaza: '#6aad7a',
  green: '#4f9464',
};

function groundGeometry(poly: { x: number; y: number }[]): THREE.BufferGeometry {
  if (poly.length < 3) return new THREE.BufferGeometry();
  // Fan triangulation from first vertex
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of poly) {
    positions.push(p.x, 0.03, -p.y);
  }
  for (let i = 1; i < poly.length - 1; i++) {
    indices.push(0, i, i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function TreeMesh({ x, y }: { x: number; y: number }) {
  const trunk = useMemo(() => new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6), []);
  const crown = useMemo(() => new THREE.ConeGeometry(1.1, 2.2, 7), []);
  const trunkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 }),
    []
  );
  const crownMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2d6a3e', roughness: 0.85 }),
    []
  );
  return (
    <group position={[x, 0, -y]}>
      <mesh geometry={trunk} material={trunkMat} position={[0, 0.7, 0]} castShadow />
      <mesh geometry={crown} material={crownMat} position={[0, 2.2, 0]} castShadow />
    </group>
  );
}

function CourtyardMesh({ court }: { court: ZoneCourtyard }) {
  const geo = useMemo(() => groundGeometry(court.polygon), [court.polygon]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: GREEN[court.kind] ?? GREEN.green,
        roughness: 0.95,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -0.5,
      }),
    [court.kind]
  );

  return (
    <group
      userData={{
        kind: 'zone-courtyard',
        courtyardId: court.id,
        zoneId: court.zoneId,
        nonPickable: false,
      }}
    >
      <mesh geometry={geo} material={mat} receiveShadow />
      {court.trees.map((t, i) => (
        <TreeMesh key={i} x={t.x} y={t.y} />
      ))}
    </group>
  );
}

export function ZoneCourtyardsLayer({ courtyards }: Props) {
  if (!courtyards?.length) return null;
  return (
    <group name="ZoneCourtyardsLayer">
      {courtyards.map((c) => (
        <CourtyardMesh key={c.id} court={c} />
      ))}
    </group>
  );
}
