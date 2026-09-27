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
    // ExtrudeGeometry is in XY, depth along +Z → rotate to Y-up:
    // (x,y,z) → (x, z, -y) so world Z = -localY
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, [building.footprint, building.heightM]);

  const wallMat = useMemo(
    () => getFacadeMaterial(style, 20, building.heightM, quality),
    [style, building.heightM, quality]
  );
  const roofMat = useMemo(() => getRoofMaterial(style), [style]);

  // Roof: same footprint extruded thinly, then lifted to roof height.
  // Same rotateX so it stays glued to the building massing.
  const roofGeom = useMemo(() => {
    const shape = shapeFromFootprint(building.footprint);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.4,
      bevelEnabled: false,
      steps: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, building.heightM, 0);
    g.computeVertexNormals();
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
