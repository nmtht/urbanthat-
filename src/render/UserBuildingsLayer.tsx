import { useMemo } from 'react';
import * as THREE from 'three';
import type { GeneratedBuilding } from '../domain/zones';
import {
  getFacadeMaterial,
  getRoofMaterial,
  type FacadeQuality,
  type FacadeStyle,
} from './buildingFacades';
import { styleFromZoneType } from '../geometry/zoneGenerate';

interface Props {
  buildings: GeneratedBuilding[];
  quality: FacadeQuality;
}

function shapeFromFootprint(fp: { x: number; y: number }[]): THREE.Shape {
  const shape = new THREE.Shape();
  if (fp.length < 3) return shape;
  shape.moveTo(fp[0].x, fp[0].y);
  for (let i = 1; i < fp.length; i++) shape.lineTo(fp[i].x, fp[i].y);
  shape.closePath();
  return shape;
}

function BuildingMesh({
  building,
  quality,
}: {
  building: GeneratedBuilding;
  quality: FacadeQuality;
}) {
  const style = styleFromZoneType(building.type) as FacadeStyle;
  const geom = useMemo(() => {
    const shape = shapeFromFootprint(building.footprint);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: building.heightM,
      bevelEnabled: false,
      steps: 1,
    });
    // ExtrudeGeometry is in XY, depth along Z → rotate to Y-up
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, [building.footprint, building.heightM]);

  const wallMat = useMemo(
    () => getFacadeMaterial(style, 20, building.heightM, quality),
    [style, building.heightM, quality]
  );
  const roofMat = useMemo(() => getRoofMaterial(style), [style]);

  // Roof as a thin box on top (simple, readable massing)
  const roofGeom = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of building.footprint) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(0.5, maxX - minX);
    const d = Math.max(0.5, maxY - minY);
    const g = new THREE.BoxGeometry(w, 0.35, d);
    g.translate((minX + maxX) / 2, building.heightM + 0.15, (minY + maxY) / 2);
    return g;
  }, [building.footprint, building.heightM]);

  return (
    <group
      userData={{
        kind: 'user-building',
        buildingId: building.id,
        zoneId: building.zoneId,
        nonPickable: false,
      }}
    >
      <mesh
        geometry={geom}
        material={wallMat}
        castShadow
        receiveShadow
        userData={{
          kind: 'user-building',
          buildingId: building.id,
          zoneId: building.zoneId,
        }}
      />
      <mesh
        geometry={roofGeom}
        material={roofMat}
        userData={{
          kind: 'user-building',
          buildingId: building.id,
          zoneId: building.zoneId,
        }}
      />
    </group>
  );
}

export function UserBuildingsLayer({ buildings, quality }: Props) {
  if (!buildings.length) return null;
  return (
    <group name="UserBuildingsLayer">
      {buildings.map((b) => (
        <BuildingMesh key={b.id} building={b} quality={quality} />
      ))}
    </group>
  );
}
