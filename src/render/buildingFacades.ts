import * as THREE from 'three';

export type FacadeStyle = 'residential' | 'office' | 'industrial' | 'generic';

export function facadeStyleFromBuildingTag(building?: string): FacadeStyle {
  const t = (building ?? 'yes').toLowerCase();
  if (
    t === 'apartments' ||
    t === 'residential' ||
    t === 'house' ||
    t === 'detached' ||
    t === 'terrace' ||
    t === 'semidetached_house' ||
    t === 'dormitory'
  ) {
    return 'residential';
  }
  if (
    t === 'office' ||
    t === 'commercial' ||
    t === 'retail' ||
    t === 'hotel' ||
    t === 'public' ||
    t === 'civic' ||
    t === 'school' ||
    t === 'university' ||
    t === 'hospital'
  ) {
    return 'office';
  }
  if (t === 'industrial' || t === 'warehouse' || t === 'manufacture' || t === 'factory') {
    return 'industrial';
  }
  return 'generic';
}

interface StyleParams {
  winW: number;
  floorH: number;
  wall: string;
  roof: string;
  roughness: number;
  metalness: number;
  glass: string;
}

const STYLE: Record<FacadeStyle, StyleParams> = {
  residential: {
    winW: 3.2,
    floorH: 3.0,
    wall: '#b0a89e',
    roof: '#5c564e',
    roughness: 0.88,
    metalness: 0.02,
    glass: '#1a2838',
  },
  office: {
    winW: 2.2,
    floorH: 3.5,
    wall: '#9aa4b0',
    roof: '#4a5260',
    roughness: 0.5,
    metalness: 0.18,
    glass: '#152030',
  },
  industrial: {
    winW: 5.0,
    floorH: 4.2,
    wall: '#8e8e8a',
    roof: '#454545',
    roughness: 0.92,
    metalness: 0.06,
    glass: '#222820',
  },
  generic: {
    winW: 3.4,
    floorH: 3.2,
    wall: '#a39e96',
    roof: '#524e4a',
    roughness: 0.85,
    metalness: 0.05,
    glass: '#1c2430',
  },
};

const wallMats = new Map<string, THREE.MeshStandardMaterial>();
const roofMats = new Map<string, THREE.MeshStandardMaterial>();

export function getFacadeMaterial(
  style: FacadeStyle,
  _footprintApproxM: number,
  heightM: number
): THREE.MeshStandardMaterial {
  const p = STYLE[style];
  const floors = Math.max(1, Math.round(heightM / p.floorH));
  const key = `${style}:h${floors}`;

  let mat = wallMats.get(key);
  if (mat) return mat;

  mat = new THREE.MeshStandardMaterial({
    color: p.wall,
    roughness: p.roughness,
    metalness: p.metalness,
  });

  const floorH = p.floorH;
  const winW = p.winW;
  const glassColor = new THREE.Color(p.glass);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFloorH = { value: floorH };
    shader.uniforms.uWinW = { value: winW };
    shader.uniforms.uGlass = { value: glassColor };
    shader.uniforms.uHeight = { value: heightM };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNorm;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFloorH;
uniform float uWinW;
uniform vec3 uGlass;
uniform float uHeight;
varying vec3 vWPos;
varying vec3 vWNorm;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float vert = 1.0 - abs(vWNorm.y);
if (vert > 0.55) {
  vec3 n = normalize(vWNorm);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(up, n));
  if (length(tangent) < 0.1) tangent = vec3(1.0, 0.0, 0.0);
  float along = dot(vWPos, tangent);
  float h = vWPos.y;

  if (h > 0.4 && h < uHeight - 0.25) {
    float cellX = fract(along / uWinW);
    float cellY = fract(h / uFloorH);
    float wx = step(0.18, cellX) * step(cellX, 0.82);
    float wy = step(0.22, cellY) * step(cellY, 0.82);
    float win = wx * wy * smoothstep(0.55, 0.75, vert);
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, win * 0.92);
  }
}
`
      );
  };
  mat.customProgramCacheKey = () => key;

  wallMats.set(key, mat);
  return mat;
}

export function getRoofMaterial(style: FacadeStyle): THREE.MeshStandardMaterial {
  let mat = roofMats.get(style);
  if (mat) return mat;
  const p = STYLE[style];
  mat = new THREE.MeshStandardMaterial({
    color: p.roof,
    roughness: 0.92,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  roofMats.set(style, mat);
  return mat;
}

export function ringPerimeter(ring: { x: number; y: number }[]): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

export function applyFacadeUVs(
  _geom: THREE.BufferGeometry,
  _repU: number,
  _repV: number
): void {}

export function facadeRepeat(
  style: FacadeStyle,
  perimeterM: number,
  heightM: number
): { repU: number; repV: number } {
  const p = STYLE[style];
  const frontage = Math.max(perimeterM * 0.35, p.winW);
  return {
    repU: Math.max(1, frontage / p.winW),
    repV: Math.max(1, heightM / p.floorH),
  };
}
