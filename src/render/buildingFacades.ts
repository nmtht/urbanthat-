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

let atlas: THREE.CanvasTexture | null = null;

function getWindowAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e8e6e2';
  ctx.fillRect(0, 0, w, h);

  const floors = 8;
  const cols = 4;
  const floorH = h / floors;
  const colW = w / cols;

  for (let fy = 0; fy < floors; fy++) {
    for (let cx = 0; cx < cols; cx++) {
      const marginX = colW * 0.18;
      const marginY = floorH * 0.22;
      const wx = cx * colW + marginX;
      const wy = fy * floorH + marginY;
      const ww = colW - marginX * 2;
      const wh = floorH - marginY * 2;

      ctx.fillStyle = '#2a3340';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(180,200,220,0.25)';
      ctx.fillRect(wx + 2, wy + 2, ww * 0.4, wh * 0.35);
      ctx.strokeStyle = 'rgba(40,40,40,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx + 0.5, wy + 0.5, ww - 1, wh - 1);
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 2;
  for (let fy = 1; fy < floors; fy++) {
    ctx.beginPath();
    ctx.moveTo(0, fy * floorH);
    ctx.lineTo(w, fy * floorH);
    ctx.stroke();
  }

  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = THREE.RepeatWrapping;
  atlas.wrapT = THREE.RepeatWrapping;
  atlas.anisotropy = 8;
  atlas.needsUpdate = true;
  return atlas;
}

interface StyleParams {
  winW: number;
  floorH: number;
  wall: string;
  roof: string;
  roughness: number;
  metalness: number;
}

const STYLE: Record<FacadeStyle, StyleParams> = {
  residential: {
    winW: 3.2,
    floorH: 3.0,
    wall: '#9a9088',
    roof: '#5c564e',
    roughness: 0.9,
    metalness: 0.02,
  },
  office: {
    winW: 2.4,
    floorH: 3.6,
    wall: '#8a929c',
    roof: '#4a5260',
    roughness: 0.55,
    metalness: 0.15,
  },
  industrial: {
    winW: 5.5,
    floorH: 4.5,
    wall: '#7a7a78',
    roof: '#454545',
    roughness: 0.95,
    metalness: 0.05,
  },
  generic: {
    winW: 3.5,
    floorH: 3.3,
    wall: '#8a8680',
    roof: '#524e4a',
    roughness: 0.88,
    metalness: 0.05,
  },
};

const wallMats = new Map<string, THREE.MeshStandardMaterial>();
const roofMats = new Map<string, THREE.MeshStandardMaterial>();

export function getFacadeMaterial(
  style: FacadeStyle,
  footprintApproxM: number,
  heightM: number
): THREE.MeshStandardMaterial {
  const p = STYLE[style];
  const repU = Math.max(1, Math.round(footprintApproxM / p.winW));
  const repV = Math.max(1, Math.round(heightM / p.floorH));
  const key = `${style}:${repU}x${repV}`;

  let mat = wallMats.get(key);
  if (mat) return mat;

  const map = getWindowAtlas().clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repU, repV);
  map.needsUpdate = true;

  mat = new THREE.MeshStandardMaterial({
    color: p.wall,
    map,
    roughness: p.roughness,
    metalness: p.metalness,
  });
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
  geom: THREE.BufferGeometry,
  repU: number,
  repV: number
): void {
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * repU, uv.getY(i) * repV);
  }
  uv.needsUpdate = true;
}

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
