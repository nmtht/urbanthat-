import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ZoneRect, ZoneType } from '../domain/zones';
import { ZONE_COLORS } from '../domain/zones';

interface Props {
  enabled: boolean;
  zoneType: ZoneType;
  onCommit: (zone: ZoneRect) => void;
}

/** Drag rectangle on ground plane to paint a zone. */
export function ZoneBridge({ enabled, zoneType, onCommit }: Props) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const preview = useRef<THREE.Mesh | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const typeRef = useRef(zoneType);
  typeRef.current = zoneType;

  useEffect(() => {
    if (!enabled) {
      drag.current = null;
      if (preview.current) preview.current.visible = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const toLocal = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const ok = raycaster.ray.intersectPlane(ground, hit);
      if (!ok) return null;
      return { x: hit.x, y: -hit.z };
    };

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const p = toLocal(ev.clientX, ev.clientY);
      if (!p) return;
      drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      el.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      const p = toLocal(ev.clientX, ev.clientY);
      if (!p) return;
      drag.current.x1 = p.x;
      drag.current.y1 = p.y;
    };
    const onUp = (ev: PointerEvent) => {
      if (!drag.current) return;
      const d = drag.current;
      drag.current = null;
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      const minX = Math.min(d.x0, d.x1);
      const maxX = Math.max(d.x0, d.x1);
      const minY = Math.min(d.y0, d.y1);
      const maxY = Math.max(d.y0, d.y1);
      if (maxX - minX < 4 || maxY - minY < 4) return;
      onCommitRef.current({
        id: `zone-${Date.now()}`,
        type: typeRef.current,
        minX,
        maxX,
        minY,
        maxY,
      });
      if (preview.current) preview.current.visible = false;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [enabled, camera, gl, raycaster, pointer, ground, hit]);

  useFrame(() => {
    const mesh = preview.current;
    const d = drag.current;
    if (!mesh || !d) {
      if (mesh) mesh.visible = false;
      return;
    }
    const minX = Math.min(d.x0, d.x1);
    const maxX = Math.max(d.x0, d.x1);
    const minY = Math.min(d.y0, d.y1);
    const maxY = Math.max(d.y0, d.y1);
    const w = maxX - minX;
    const h = maxY - minY;
    mesh.visible = w > 0.5 && h > 0.5;
    mesh.position.set((minX + maxX) / 2, 0.03, -(minY + maxY) / 2);
    mesh.scale.set(w, 1, h);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(ZONE_COLORS[typeRef.current]);
  });

  return (
    <group>
      <mesh ref={preview} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.35} depthWrite={false} color={ZONE_COLORS[zoneType]} />
      </mesh>
    </group>
  );
}

export function ZoneMeshes({ zones }: { zones: ZoneRect[] }) {
  return (
    <group name="Zones">
      {zones.map((z) => {
        const w = z.maxX - z.minX;
        const h = z.maxY - z.minY;
        return (
          <mesh
            key={z.id}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[(z.minX + z.maxX) / 2, 0.025, -(z.minY + z.maxY) / 2]}
            scale={[w, 1, h]}
            userData={{ kind: 'zone', zoneId: z.id, zoneType: z.type, nonPickable: true }}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              color={ZONE_COLORS[z.type]}
              transparent
              opacity={0.28}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
