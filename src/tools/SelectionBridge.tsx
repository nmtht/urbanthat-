import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ToolId } from '../ui/Toolbar';

export interface SelectedOsm {
  object: THREE.Object3D;
  kind: string;
  label: string;
  objects: THREE.Object3D[];
  zoneId?: string;
  roadId?: string;
}

interface Props {
  tool: ToolId;
  enabled: boolean;
  selected: SelectedOsm | null;
  onSelect: (sel: SelectedOsm | null) => void;
  onDeleteClick: (sel: SelectedOsm) => void;
}

function isPickable(obj: THREE.Object3D): boolean {
  if (!obj.visible || obj.userData?.deleted) return false;
  if (obj.userData?.nonPickable) return false;
  const kind = obj.userData?.kind;
  if (kind === 'user-road' || kind === 'zone') return true;
  if (!kind || !obj.userData?.osmTags) return false;
  if (kind === 'road-pad' || kind === 'tree') return false;
  return true;
}

function findPickRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (isPickable(cur)) return cur;
    if (
      cur.parent &&
      cur.parent.userData?.kind === 'building' &&
      cur.parent.userData?.osmTags &&
      !cur.parent.userData?.deleted
    ) {
      return cur.parent;
    }
    cur = cur.parent;
  }
  return null;
}

function labelOf(obj: THREE.Object3D): string {
  const tags = (obj.userData?.osmTags ?? {}) as Record<string, string>;
  const kind = String(obj.userData?.kind ?? 'item');
  if (kind === 'building') {
    return tags.name ?? (tags.building && tags.building !== 'yes' ? tags.building : 'building');
  }
  if (kind === 'road' || kind === 'user-road') {
    return tags.name ?? tags.highway ?? 'road';
  }
  if (kind === 'zone') {
    return tags.name ?? tags.landuse ?? 'zone';
  }
  return tags.name ?? kind;
}

function matchKey(obj: THREE.Object3D): string {
  const tags = (obj.userData?.osmTags ?? {}) as Record<string, string>;
  const kind = String(obj.userData?.kind ?? '');
  if (kind === 'building') return `building:${tags.building ?? 'yes'}`;
  if (kind === 'road') return `highway:${tags.highway ?? 'road'}`;
  if (kind === 'user-road') return `user-road:${obj.userData?.roadId ?? ''}`;
  if (kind === 'zone') return `zone:${obj.userData?.zoneId ?? ''}`;
  return `${kind}:${tags.name ?? ''}`;
}

function clearHighlights(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const orig = obj.userData.__selMatOrig as THREE.Material | THREE.Material[] | undefined;
    if (!orig) return;
    const cur = obj.material;
    if (Array.isArray(cur)) cur.forEach((m) => m.dispose());
    else (cur as THREE.Material)?.dispose?.();
    obj.material = orig;
    delete obj.userData.__selMatOrig;
  });
}

function boostObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData.__selMatOrig) return;
    const mat = obj.material as THREE.Material | THREE.Material[];
    const cloneOne = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const s = c as THREE.MeshStandardMaterial;
        s.emissive = new THREE.Color('#4a9eff');
        s.emissiveIntensity = 0.45;
        s.needsUpdate = true;
      } else if ((c as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
        const b = c as THREE.MeshBasicMaterial;
        b.color = b.color.clone().lerp(new THREE.Color('#4a9eff'), 0.35);
        b.opacity = Math.min(1, (b.opacity ?? 1) * 1.4);
        b.needsUpdate = true;
      }
      return c;
    };
    obj.userData.__selMatOrig = mat;
    if (Array.isArray(mat)) obj.material = mat.map(cloneOne);
    else obj.material = cloneOne(mat);
  });
}

export function SelectionBridge({ tool, enabled, selected, onSelect, onDeleteClick }: Props) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastClick = useRef<{ t: number; key: string } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDeleteRef = useRef(onDeleteClick);
  onDeleteRef.current = onDeleteClick;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    clearHighlights(scene);
    if (!selected?.objects?.length) return;
    for (const obj of selected.objects) boostObject(obj);
  }, [selected, scene]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const osmGroup = scene.getObjectByName('OsmContextLayer');
      const userRoads = scene.getObjectByName('UserRoadsLayer');
      const zones = scene.getObjectByName('Zones');
      const roots: THREE.Object3D[] = [];
      if (zones) roots.push(zones);
      if (userRoads) roots.push(userRoads);
      if (osmGroup) roots.push(osmGroup);
      if (!roots.length) roots.push(...scene.children);
      const hits = raycaster.intersectObjects(roots, true);

      let bestZone: THREE.Object3D | null = null;
      let bestUserRoad: THREE.Object3D | null = null;
      let bestRoad: THREE.Object3D | null = null;
      for (const hit of hits) {
        if (!hit.object.visible) continue;
        const root = findPickRoot(hit.object);
        if (!root || !root.visible || root.userData.deleted) continue;
        if (root.userData.kind === 'building') return root;
        if (root.userData.kind === 'zone') {
          if (!bestZone) bestZone = root;
          continue;
        }
        if (root.userData.kind === 'user-road') {
          if (!bestUserRoad) bestUserRoad = root;
          continue;
        }
        if (!bestRoad) bestRoad = root;
      }
      return bestZone ?? bestUserRoad ?? bestRoad;
    };

    const collectSameTag = (seed: THREE.Object3D): THREE.Object3D[] => {
      const key = matchKey(seed);
      const out: THREE.Object3D[] = [];
      const osmGroup = scene.getObjectByName('OsmContextLayer');
      (osmGroup ?? scene).traverse((obj) => {
        if (!isPickable(obj)) return;
        if (matchKey(obj) === key) out.push(obj);
      });
      return out.length ? out : [seed];
    };

    const toSel = (hit: THREE.Object3D, objects: THREE.Object3D[]): SelectedOsm => ({
      object: hit,
      kind: String(hit.userData.kind),
      label: labelOf(hit),
      objects,
      zoneId: hit.userData.zoneId as string | undefined,
      roadId: hit.userData.roadId as string | undefined,
    });

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      down.current = { x: ev.clientX, y: ev.clientY, t: Date.now() };
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.button !== 0 || !down.current) return;
      const dx = ev.clientX - down.current.x;
      const dy = ev.clientY - down.current.y;
      const dt = Date.now() - down.current.t;
      down.current = null;
      if (Math.hypot(dx, dy) > 4 || dt > 500) return;

      const hit = pick(ev.clientX, ev.clientY);
      const t = toolRef.current;
      const now = Date.now();

      if (t === 'delete') {
        if (hit) onDeleteRef.current(toSel(hit, [hit]));
        return;
      }

      if (t !== 'select') return;

      if (!hit) {
        lastClick.current = null;
        onSelectRef.current(null);
        return;
      }

      const key = matchKey(hit);
      const isDouble =
        lastClick.current && lastClick.current.key === key && now - lastClick.current.t < 350;
      lastClick.current = { t: now, key };

      if (isDouble && hit.userData.kind !== 'user-road' && hit.userData.kind !== 'zone') {
        const all = collectSameTag(hit);
        onSelectRef.current(toSel(hit, all));
      } else {
        onSelectRef.current(toSel(hit, [hit]));
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [enabled, camera, scene, gl, raycaster, pointer]);

  return null;
}
