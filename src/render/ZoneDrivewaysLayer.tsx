/**
 * Renders zone-internal driveways (fire / access lanes) as asphalt ribbons.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { ZoneDriveway } from '../domain/zones';

interface Props {
  driveways: ZoneDriveway[];
}

function ribbonGeometry(centerline: { x: number; y: number }[], halfW: number): THREE.BufferGeometry {
  const n = centerline.length;
  if (n < 2) return new THREE.BufferGeometry();

  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const p = centerline[i];
    // Scene: XZ ground, Y up; plan-y maps to -z
    left.push(p.x + nx * halfW, 0.05, -p.y);
    right.push(p.x - nx * halfW, 0.05, -p.y);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    positions.push(left[i * 3], left[i * 3 + 1], left[i * 3 + 2]);
    positions.push(right[i * 3], right[i * 3 + 1], right[i * 3 + 2]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function DrivewayMesh({ dw }: { dw: ZoneDriveway }) {
  const geo = useMemo(
    () => ribbonGeometry(dw.centerline, dw.halfWidthM),
    [dw.centerline, dw.halfWidthM]
  );
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a3a38',
        roughness: 0.92,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    []
  );

  return (
    <mesh
      geometry={geo}
      material={mat}
      receiveShadow
      userData={{
        kind: 'zone-driveway',
        drivewayId: dw.id,
        zoneId: dw.zoneId,
        nonPickable: false,
      }}
    />
  );
}

export function ZoneDrivewaysLayer({ driveways }: Props) {
  if (!driveways.length) return null;
  return (
    <group name="ZoneDrivewaysLayer">
      {driveways.map((dw) => (
        <DrivewayMesh key={dw.id} dw={dw} />
      ))}
    </group>
  );
}
