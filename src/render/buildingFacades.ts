import * as THREE from 'three';

export type FacadeStyle = 'residential' | 'office' | 'industrial' | 'generic';
export type FacadeQuality = 'low' | 'med' | 'high';

const STYLE: Record<
  FacadeStyle,
  {
    wall: string;
    roof: string;
    glass: string;
    floorH: number;
    winW: number;
    roughness: number;
    metalness: number;
    surface: string;
  }
> = {
  residential: {
    wall: '#c4b8a8',
    roof: '#5a5048',
    glass: '#1a2a38',
    floorH: 3.0,
    winW: 2.4,
    roughness: 0.88,
    metalness: 0.02,
    surface: 'stucco',
  },
  office: {
    wall: '#a8b0b8',
    roof: '#3a4048',
    glass: '#0e1c28',
    floorH: 3.6,
    winW: 3.2,
    roughness: 0.55,
    metalness: 0.15,
    surface: 'panel',
  },
  industrial: {
    wall: '#8a8880',
    roof: '#4a4840',
    glass: '#222820',
    floorH: 4.2,
    winW: 4.0,
    roughness: 0.92,
    metalness: 0.08,
    surface: 'metal',
  },
  generic: {
    wall: '#b0aaa0',
    roof: '#504840',
    glass: '#182028',
    floorH: 3.3,
    winW: 2.8,
    roughness: 0.85,
    metalness: 0.04,
    surface: 'stucco',
  },
};

const wallMats = new Map<string, THREE.MeshStandardMaterial>();
const roofMats = new Map<string, THREE.MeshStandardMaterial>();
const emissiveMats: THREE.MeshStandardMaterial[] = [];
const surfaceTexCache = new Map<string, THREE.CanvasTexture>();

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
  if (t === 'industrial' || t === 'warehouse' || t === 'factory' || t === 'manufacture') {
    return 'industrial';
  }
  return 'generic';
}

function makeSurfaceTexture(kind: string): THREE.CanvasTexture {
  let tex = surfaceTexCache.get(kind);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, 64, 64);
  if (kind === 'panel') {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 64; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 64);
      ctx.stroke();
    }
  } else if (kind === 'metal') {
    for (let y = 0; y < 64; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, y, 64, 2);
    }
  } else {
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * 64, Math.random() * 64, 1, 1);
    }
  }
  tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  surfaceTexCache.set(kind, tex);
  return tex;
}

const VERT_COMMON = `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;`;

const VERT_BEGIN = `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`;

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

  if (quality === 'med') {
    mat = new THREE.MeshStandardMaterial({
      color: p.wall,
      roughness: p.roughness,
      metalness: p.metalness,
    });
    const floorH = p.floorH;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFloorH = { value: floorH };
      mat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', VERT_COMMON)
        .replace('#include <begin_vertex>', VERT_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uFloorH;
varying vec3 vWPos;
varying vec3 vWNormal;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float wall = 1.0 - abs(vWNormal.y);
  float band = fract(vWPos.y / max(uFloorH, 0.5));
  float line = smoothstep(0.88, 0.98, band) * smoothstep(0.25, 0.55, wall);
  diffuseColor.rgb *= 1.0 - line * 0.42;
  float storey = step(0.5, band);
  diffuseColor.rgb *= mix(1.0, 0.92, storey * wall);
}
`
        );
    };
    mat.customProgramCacheKey = () => key;
    wallMats.set(key, mat);
    return mat;
  }

  mat = new THREE.MeshStandardMaterial({
    color: '#d8d2c8',
    map: makeSurfaceTexture(p.surface),
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
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_COMMON)
      .replace('#include <begin_vertex>', VERT_BEGIN);

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
varying vec3 vWNormal;
float winMask = 0.0;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float wall = 1.0 - abs(vWNormal.y);
  wall = smoothstep(0.35, 0.75, wall);
  float h = vWPos.y;
  if (h > 0.5 && h < uHeight - 0.3 && wall > 0.01) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(vWNormal, up));
    if (length(tangent) < 0.1) tangent = vec3(1.0, 0.0, 0.0);
    float along = dot(vWPos, tangent);
    float cellX = fract(along / max(uWinW, 0.5));
    float cellY = fract(h / max(uFloorH, 0.5));
    float wx = step(0.15, cellX) * step(cellX, 0.85);
    float wy = step(0.18, cellY) * step(cellY, 0.82);
    winMask = wx * wy * wall;
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, winMask * 0.88);
  }
}
`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.72, 0.35) * winMask * uNight * 1.5;
`
      );
  };
  mat.customProgramCacheKey = () => key;
  emissiveMats.push(mat);
  wallMats.set(key, mat);
  return mat;
}

export function clearFacadeCache(): void {
  wallMats.clear();
  emissiveMats.length = 0;
}

export function setFacadeNightFactor(hour: number): void {
  let night = 0;
  if (hour <= 5.5 || hour >= 21) night = 1;
  else if (hour < 7.5) night = 1 - (hour - 5.5) / 2.0;
  else if (hour > 18.5) night = (hour - 18.5) / 2.5;
  night = Math.max(0, Math.min(1, night));
  night = night * night * (3 - 2 * night);

  for (const mat of emissiveMats) {
    const shader = mat.userData?.shader as
      | { uniforms: { uNight?: { value: number } } }
      | undefined;
    if (shader?.uniforms?.uNight) {
      shader.uniforms.uNight.value = night;
    }
    mat.emissiveIntensity = night * 0.12;
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

/** Re-assign wall materials + toggle trees/lamps when quality changes. */
export function applyQualityToOsmGroup(
  group: THREE.Group,
  quality: FacadeQuality
): void {
  group.traverse((obj) => {
    const kind = obj.userData?.kind as string | undefined;
    if (kind === 'tree') {
      obj.visible = quality === 'high';
      return;
    }
    if (obj.name === 'StreetLamps') {
      obj.visible = quality === 'high';
      return;
    }
    if (obj instanceof THREE.Light && obj.userData?.kind === 'street-lamp-light') {
      obj.visible = quality === 'high';
      return;
    }
    if (obj instanceof THREE.Mesh && obj.name === 'building-wall') {
      const style = (obj.userData.facadeStyle as FacadeStyle) || 'generic';
      const height = (obj.userData.buildingHeight as number) || 9;
      const peri = (obj.userData.perimeter as number) || 20;
      obj.material = getFacadeMaterial(style, peri * 0.35, height, quality);
    }
  });
  const lamps = group.getObjectByName('StreetLamps');
  if (lamps) lamps.visible = quality === 'high';
}
