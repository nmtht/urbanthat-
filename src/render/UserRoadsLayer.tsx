import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoadCenterline } from '../domain/roads';
import { buildRoadGeometry, localToWorld } from '../geometry/roadBuild';

interface Props {
  roads: RoadCenterline[];
}

function ringToShape(ring: { x: number; y: number }[]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].y);
  shape.closePath();
  return shape;
}

/**
 * Renders committed user roads as asphalt meshes + dashed centerlines.
 * Separate from OSM context; pickable as kind: 'user-road'.
 */
export function UserRoadsLayer({ roads }: Props) {
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

    for (const road of roads) {
      const g = buildRoadGeometry(road);
      if (!g) continue;

      const shape = ringToShape(g.carriagePoly);
      if (!shape) continue;

      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, 0.065, 0);

      const mat = new THREE.MeshStandardMaterial({
        color: g.profile.asphaltColor,
        roughness: 0.85,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = `user-road-${g.id}`;
      mesh.userData = {
        kind: 'user-road',
        roadId: g.id,
        nonPickable: false,
        osmTags: { highway: g.profile.id, name: g.profile.label },
      };
      group.add(mesh);

      if (g.markingSegments.length > 0) {
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
    }
  }, [roads, scene]);

  return null;
}
