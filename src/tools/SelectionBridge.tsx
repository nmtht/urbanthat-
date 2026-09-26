import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ToolId } from '../ui/Toolbar';

export interface SelectedOsm {
  /** Primary object (group for buildings, mesh for roads). */
  object: THREE.Object3D;
  kind: string;
  label: string;
  /** All objects in current selection (multi-select). */
  objects: THREE.Object3D[];
}

interface Props {
  tool: ToolId;
  enabled: boolean;
  selected: SelectedOsm | null;
  onSelect: (sel: SelectedOsm | null) => void;
  onDeleteClick: (sel: SelectedOsm) => void;
}

function isPickableOsm(obj: THREE.Object3D): boolean {
  if (!obj.visible || obj.userData?.deleted) return false;
  if (obj.userData?.nonPickable) return false;
  if (!obj.userData?.kind || !obj.userData?.osmTags) return false;
  if (obj.userData.kind === 'road-pad' || obj.userData.kind === 'tree') return false;
  return true;
}

/** Walk up to the selectable OSM root (building Group or road Mesh). */
function findOsmRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (isPickableOsm(cur)) return cur;
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
  if (kind === 'road') {
    return tags.name ?? tags.highway ?? 'road';
  }
  return tags.name ?? kind;
}

/** Primary tag key used for same-type multi-select. */
function matchKey(obj: THREE.Object3D): string {
  const tags = (obj.userData?.osmTags ?? {}) as Record<string, string>;
  const kind = String(obj.userData?.kind ?? '');
  if (kind === 'building') {
    const b = tags.building ?? 'yes';
    return `building:${b}`;
  }
  if (kind === 'road') {
    return `highway:${tags.highway ?? 'road'}`;
  }
  return `${kind}:${tags.name ?? ''}`;
}

function clearHighlights(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const apply = (m: THREE.MeshStandardMaterial) => {
      if (m.userData?.__selBoost) {
        m.emissive.copy(m.userData.__selPrevEmissive as THREE.Color);
        m.emissiveIntensity = m.userData.__selPrevIntensity as number;
        delete m.userData.__selBoost;
        delete m.userData.__selPrevEmissive;
        delete m.userData.__selPrevIntensity;
        m.needsUpdate = true;
      }
    };
    if (Array.isArray(mat)) mat.forEach(apply);
    else if (mat) apply(mat);
  });
}

function boostObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const boost = (m: THREE.MeshStandardMaterial) => {
      if (!m.isMeshStandardMaterial) return;
      if (m.userData?.__selBoost) return;
      m.userData.__selPrevEmissive = m.emissive.clone();
      m.userData.__selPrevIntensity = m.emissiveIntensity;
      m.userData.__selBoost = true;
      m.emissive.set('#4a9eff');
      m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.35);
      m.needsUpdate = true;
    };
    if (Array.isArray(mat)) mat.forEach(boost);
    else if (mat) boost(mat);
  });
}

/**
 * Click = select exact object under cursor (nearest pickable).
 * Double-click = select all with same primary OSM tag.
 * Delete tool = remove clicked / selection (building group includes roof).
 */
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
      const roots = osmGroup ? [osmGroup] : scene.children;
      const hits = raycaster.intersectObjects(roots, true);
      let bestRoad: { obj: THREE.Object3D; dist: number } | null = null;
      for (const hit of hits) {
        if (!hit.object.visible) continue;
        const root = findOsmRoot(hit.object);
        if (!root || !root.visible || root.userData.deleted) continue;
        // Prefer buildings over thin road geometry when both are hit
        if (root.userData.kind === 'building') return root;
        if (!bestRoad) bestRoad = { obj: root, dist: hit.distance };
      }
      return bestRoad?.obj ?? null;
    };

    const collectSameTag = (seed: THREE.Object3D): THREE.Object3D[] => {
      const key = matchKey(seed);
      const out: THREE.Object3D[] = [];
      const osmGroup = scene.getObjectByName('OsmContextLayer');
      const root = osmGroup ?? scene;
      root.traverse((obj) => {
        if (!isPickableOsm(obj)) return;
        if (matchKey(obj) === key) out.push(obj);
      });
      return out.length ? out : [seed];
    };

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
        if (hit) {
          onDeleteRef.current({
            object: hit,
            kind: String(hit.userData.kind),
            label: labelOf(hit),
            objects: [hit],
          });
        }
        return;
      }

      if (!hit) {
        lastClick.current = null;
        onSelectRef.current(null);
        return;
      }

      const key = matchKey(hit);
      const isDouble =
        lastClick.current &&
        lastClick.current.key === key &&
        now - lastClick.current.t < 350;

      lastClick.current = { t: now, key };

      if (isDouble) {
        const all = collectSameTag(hit);
        onSelectRef.current({
          object: hit,
          kind: String(hit.userData.kind),
          label: `${labelOf(hit)} ×${all.length}`,
          objects: all,
        });
      } else {
        onSelectRef.current({
          object: hit,
          kind: String(hit.userData.kind),
          label: labelOf(hit),
          objects: [hit],
        });
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
