import * as THREE from 'three';

export type FacadeStyle = 'residential' | 'office' | 'industrial' | 'generic';
export type FacadeQuality = 'low' | 'med' | 'high';

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
  surface: 'plaster' | 'brick' | 'concrete' | 'glass';
}

const STYLE: Record<FacadeStyle, StyleParams> = {
  residential: {
    winW: 3.2,
    floorH: 3.0,
    wall: '#b8aea4',
    roof: '#5c564e',
    roughness: 0.88,
    metalness: 0.02,
    glass: '#1a2838',
    surface: 'plaster',
  },
  office: {
    winW: 2.2,
    floorH: 3.5,
    wall: '#9aa4b0',
    roof: '#4a5260',
    roughness: 0.45,
    metalness: 0.22,
    glass: '#0e1a28',
    surface: 'glass',
  },
  industrial: {
    winW: 5.0,
    floorH: 4.2,
    wall: '#8e8e8a',
    roof: '#454545',
    roughness: 0.92,
    metalness: 0.06,
    glass: '#222820',
    surface: 'concrete',
  },
  generic: {
    winW: 3.4,
    floorH: 3.2,
    wall: '#a39e96',
    roof: '#524e4a',
    roughness: 0.85,
    metalness: 0.05,
    glass: '#1c2430',
    surface: 'brick',
  },
};

const wallMats = new Map<string, THREE.MeshStandardMaterial>();
const roofMats = new Map<string, THREE.MeshStandardMaterial>();
const surfaceTex = new Map<string, THREE.CanvasTexture>();
const emissiveMats: THREE.MeshStandardMaterial[] = [];

function makeSurfaceTexture(kind: StyleParams['surface']): THREE.CanvasTexture {
  const cached = surfaceTex.get(kind);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'brick') {
    ctx.fillStyle = '#9a6b52';
    ctx.fillRect(0, 0, size, size);
    const bh = 16;
    const bw = 32;
    for (let y = 0; y < size; y += bh) {
      const off = (y / bh) % 2 === 0 ? 0 : bw / 2;
      for (let x = -bw; x < size + bw; x += bw) {
        ctx.fillStyle = `rgb(${140 + ((x * 3 + y) % 25)},${90 + ((x + y) % 20)},${70 + (x % 15)})`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  } else if (kind === 'concrete') {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#9a9a96');
    g.addColorStop(1, '#7e7e7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
  } else if (kind === 'glass') {
    ctx.fillStyle = '#6a7a8a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(200,220,240,0.25)';
    ctx.fillRect(0, 0, size, size * 0.35);
  } else {
    ctx.fillStyle = '#c4bbb0';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(2, 2);
  surfaceTex.set(kind, tex);
  return tex;
}

export function getFacadeMaterial(
  style: FacadeStyle,
  _footprintApproxM: number,
  heightM: number,
  quality: FacadeQuality = 'med'
): THREE.MeshStandardMaterial {
  const p = STYLE[style];
  const floors = Math.max(1, Math.round(heightM / p.floorH));
  const key = `${style}:${quality}:h${floors}`;

  let mat = wallMats.get(key);
  if (mat) return mat;

  if (quality === 'low') {
    mat = new THREE.MeshStandardMaterial({
      color: p.wall,
      roughness: p.roughness,
      metalness: p.metalness,
    });
    wallMats.set(key, mat);
    return mat;
  }

  const usePbr = quality === 'high';
  mat = new THREE.MeshStandardMaterial({
    color: usePbr ? '#ffffff' : p.wall,
    map: usePbr ? makeSurfaceTexture(p.surface) : null,
    roughness: p.roughness,
    metalness: p.metalness,
    emissive: new THREE.Color('#ffc878'),
    emissiveIntensity: 0,
  });

  const floorH = p.floorH;
  const winW = p.winW;
  const glassColor = new THREE.Color(p.glass);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFloorH = { value: floorH };
    shader.uniforms.uWinW = { value: winW };
    shader.uniforms.uGlass = { value: glassColor };
    shader.uniforms.uHeight = { value: heightM };
    shader.uniforms.uNight = { value: 0 };
    (mat as THREE.MeshStandardMaterial & { userData: Record<string, unknown> }).userData.shader =
      shader;

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
uniform float uNight;
varying vec3 vWPos;
varying vec3 vWNorm;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float vert = 1.0 - abs(vWNorm.y);
float winMask = 0.0;
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
    winMask = wx * wy * smoothstep(0.55, 0.75, vert);
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, winMask * 0.92);
  }
}
`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.72, 0.35) * winMask * uNight * 1.4;
`
      );
  };
  mat.customProgramCacheKey = () => key;
  emissiveMats.push(mat);
  wallMats.set(key, mat);
  return mat;
}

export function setFacadeNightFactor(hour: number): void {
  let night = 0;
  if (hour < 5.5 || hour > 20.5) night = 1;
  else if (hour < 7) night = 1 - (hour - 5.5) / 1.5;
  else if (hour > 19) night = (hour - 19) / 1.5;
  night = Math.max(0, Math.min(1, night));

  for (const mat of emissiveMats) {
    const shader = mat.userData?.shader as
      | { uniforms: { uNight?: { value: number } } }
      | undefined;
    if (shader?.uniforms?.uNight) {
      shader.uniforms.uNight.value = night;
    }
    mat.emissiveIntensity = night * 0.15;
  }
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
