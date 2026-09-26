import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ToolId } from '../ui/Toolbar';

export interface SelectedOsm {
  object: THREE.Object3D;
  kind: string;
  label: string;
}

interface Props {
  tool: ToolId;
  enabled: boolean;
  selected: SelectedOsm | null;
  onSelect: (sel: SelectedOsm | null) => void;
  onDeleteClick: (sel: SelectedOsm) => void;
}

function findOsmRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.userData?.kind && cur.userData?.osmTags && !cur.userData?.deleted) {
      return cur;
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

/** Click-to-select / click-to-delete for OSM context meshes. */
export function SelectionBridge({ tool, enabled, selected, onSelect, onDeleteClick }: Props) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDeleteRef = useRef(onDeleteClick);
  onDeleteRef.current = onDeleteClick;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
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

    if (!selected?.object) return;
    selected.object.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const boost = (m: THREE.MeshStandardMaterial) => {
        if (!m.isMeshStandardMaterial) return;
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
  }, [selected, scene]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        if (!hit.object.visible) continue;
        const root = findOsmRoot(hit.object);
        if (root && root.visible && !root.userData.deleted) return root;
      }
      return null;
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
      if (Math.hypot(dx, dy) > 5 || dt > 600) return;

      const hit = pick(ev.clientX, ev.clientY);
      const t = toolRef.current;

      if (t === 'delete') {
        if (hit) {
          onDeleteRef.current({
            object: hit,
            kind: String(hit.userData.kind),
            label: labelOf(hit),
          });
        }
        return;
      }

      if (hit) {
        onSelectRef.current({
          object: hit,
          kind: String(hit.userData.kind),
          label: labelOf(hit),
        });
      } else {
        onSelectRef.current(null);
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
