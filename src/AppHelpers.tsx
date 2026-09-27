import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { HoverInfo } from './ui/HoverHud';
import type { BBox, SceneOrigin } from './domain/SceneOrigin';

export interface OsmState {
  origin: SceneOrigin;
  group: THREE.Group;
  buildingCount: number;
  roadCount: number;
  waterCount: number;
  greenCount: number;
  treeCount: number;
  bbox: BBox;
}

export function CameraFit({
  target,
  fitKey,
}: {
  target: { x: number; z: number; radius: number } | null;
  fitKey: string | null;
}) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!target) return;
    const cam = camera as THREE.PerspectiveCamera;
    const dist = Math.max(target.radius * 1.8, 80);
    cam.position.set(target.x + dist * 0.7, dist * 0.55, target.z + dist * 0.7);
    cam.lookAt(target.x, 0, target.z);
    cam.updateProjectionMatrix();
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c?.target) {
      c.target.set(target.x, 0, target.z);
      c.update();
    }
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function CameraYawReporter({ onYaw }: { onYaw: (deg: number) => void }) {
  const { camera } = useThree();
  const last = useRef<number>(9999);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      const deg = (e.y * 180) / Math.PI;
      if (Math.abs(deg - last.current) > 1.5) {
        last.current = deg;
        onYaw(deg);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [camera, onYaw]);
  return null;
}

function labelFromTags(kind: string, tags: Record<string, string>): HoverInfo {
  if (kind === 'building') {
    const type = tags.building && tags.building !== 'yes' ? tags.building : 'building';
    return {
      kind: 'building',
      label: tags.name ?? type,
      detail: tags.name ? type : tags['building:levels'] ? `${tags['building:levels']} levels` : undefined,
    };
  }
  if (kind === 'road' || kind === 'user-road') {
    return {
      kind: 'road',
      label: tags.name ?? tags.highway ?? 'road',
      detail: tags.name ? tags.highway : tags.lanes ? `${tags.lanes} lanes` : undefined,
    };
  }
  if (kind === 'zone') {
    return { kind: 'other', label: tags.name ?? tags.landuse ?? 'zone' };
  }
  return { kind: 'other', label: kind };
}

export function PickBridge({
  enabled,
  onHover,
}: {
  enabled: boolean;
  onHover: (info: HoverInfo | null, x: number, y: number) => void;
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (!enabled) {
      onHoverRef.current(null, 0, 0);
      lastKey.current = '';
      return;
    }
    const el = gl.domElement;
    let pending: number | null = null;
    let lastEv: PointerEvent | null = null;

    const resolve = () => {
      pending = null;
      const ev = lastEv;
      if (!ev) return;
      const rect = el.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      let info: HoverInfo | null = null;
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData?.kind && obj.userData?.osmTags && !obj.userData?.nonPickable) {
            info = labelFromTags(obj.userData.kind, obj.userData.osmTags);
            break;
          }
          if (obj.parent?.userData?.kind === 'building' && obj.parent.userData?.osmTags) {
            info = labelFromTags('building', obj.parent.userData.osmTags);
            break;
          }
          obj = obj.parent;
        }
        if (info) break;
      }
      const key = info
        ? `${info.kind}:${info.label}:${Math.round(ev.clientX / 4)}:${Math.round(ev.clientY / 4)}`
        : '';
      if (key === lastKey.current) return;
      lastKey.current = key;
      onHoverRef.current(info, ev.clientX, ev.clientY);
    };

    const onMove = (ev: PointerEvent) => {
      lastEv = ev;
      if (pending != null) return;
      pending = window.setTimeout(resolve, 32);
    };
    const onLeave = () => {
      if (pending != null) window.clearTimeout(pending);
      pending = null;
      lastKey.current = '';
      onHoverRef.current(null, 0, 0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      if (pending != null) window.clearTimeout(pending);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled, camera, scene, gl, raycaster, pointer]);

  return null;
}
