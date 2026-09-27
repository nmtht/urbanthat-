import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Point2D } from '../domain/SceneOrigin';
import type { ZoneRect, ZoneType } from '../domain/zones';
import { ZONE_COLORS } from '../domain/zones';
import type { ZoneDrawMode } from '../domain/roads';

interface Props {
  enabled: boolean;
  zoneType: ZoneType;
  drawMode: ZoneDrawMode;
  onCommit: (zone: ZoneRect) => void;
  onDrawingActive?: (active: boolean) => void;
}

const MIN_SIZE = 4;
const FREEHAND_SAMPLE = 2.0;

function bboxOf(pts: Point2D[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

export function ZoneBridge({ enabled, zoneType, drawMode, onCommit, onDrawingActive }: Props) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const rectDrag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const polyDraft = useRef<Point2D[]>([]);
  const cursor = useRef<Point2D | null>(null);
  const dragging = useRef(false);
  const lastClickT = useRef(0);
  const previewRect = useRef<THREE.Mesh>(null);
  const previewGroup = useRef<THREE.Group>(null);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const typeRef = useRef(zoneType);
  typeRef.current = zoneType;
  const modeRef = useRef(drawMode);
  modeRef.current = drawMode;
  const onDrawRef = useRef(onDrawingActive);
  onDrawRef.current = onDrawingActive;

  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const toLocal = (clientX: number, clientY: number): Point2D | null => {
    const el = gl.domElement;
    const rect = el.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    return { x: hit.x, y: -hit.z };
  };

  const discard = () => {
    rectDrag.current = null;
    polyDraft.current = [];
    cursor.current = null;
    dragging.current = false;
    onDrawRef.current?.(false);
    if (previewRect.current) previewRect.current.visible = false;
    bump();
  };

  useEffect(() => {
    if (!enabled) discard();
  }, [enabled]);

  useEffect(() => {
    discard();
  }, [drawMode]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const p = toLocal(ev.clientX, ev.clientY);
      if (!p) return;
      const mode = modeRef.current;
      onDrawRef.current?.(true);
      dragging.current = true;

      if (mode === 'rect') {
        rectDrag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      } else if (mode === 'freehand') {
        polyDraft.current = [p];
        bump();
      } else if (polyDraft.current.length === 0) {
        polyDraft.current = [p];
        bump();
      }
      try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    };

    const onMove = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY);
      if (!p) return;
      cursor.current = p;
      if (!dragging.current) { bump(); return; }
      const mode = modeRef.current;
      if (mode === 'rect' && rectDrag.current) {
        rectDrag.current.x1 = p.x;
        rectDrag.current.y1 = p.y;
      } else if (mode === 'freehand' && polyDraft.current.length >= 1) {
        const last = polyDraft.current[polyDraft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= FREEHAND_SAMPLE) {
          polyDraft.current = [...polyDraft.current, p];
          bump();
        }
      } else {
        bump();
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      dragging.current = false;
      const mode = modeRef.current;
      const p = toLocal(ev.clientX, ev.clientY);

      if (mode === 'rect') {
        const d = rectDrag.current;
        rectDrag.current = null;
        onDrawRef.current?.(false);
        if (!d) return;
        const minX = Math.min(d.x0, d.x1);
        const maxX = Math.max(d.x0, d.x1);
        const minY = Math.min(d.y0, d.y1);
        const maxY = Math.max(d.y0, d.y1);
        if (maxX - minX < MIN_SIZE || maxY - minY < MIN_SIZE) return;
        onCommitRef.current({ id: `zone-${Date.now()}`, type: typeRef.current, minX, maxX, minY, maxY });
        if (previewRect.current) previewRect.current.visible = false;
        return;
      }

      if (mode === 'freehand') {
        if (p && polyDraft.current.length >= 1) {
          const last = polyDraft.current[polyDraft.current.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) {
            polyDraft.current = [...polyDraft.current, p];
          }
        }
        const pts = polyDraft.current;
        polyDraft.current = [];
        onDrawRef.current?.(false);
        if (pts.length < 3) { bump(); return; }
        const bb = bboxOf(pts);
        if (bb.maxX - bb.minX < MIN_SIZE || bb.maxY - bb.minY < MIN_SIZE) { bump(); return; }
        onCommitRef.current({ id: `zone-${Date.now()}`, type: typeRef.current, ...bb, polygon: pts });
        bump();
        return;
      }

      if (!p) return;
      const now = Date.now();
      const isDouble = now - lastClickT.current < 320 && polyDraft.current.length >= 2;
      lastClickT.current = now;

      if (isDouble) {
        const pts = polyDraft.current;
        polyDraft.current = [];
        onDrawRef.current?.(false);
        if (pts.length >= 3) {
          const bb = bboxOf(pts);
          onCommitRef.current({ id: `zone-${Date.now()}`, type: typeRef.current, ...bb, polygon: pts });
        }
        bump();
        return;
      }

      if (polyDraft.current.length === 0) {
        polyDraft.current = [p];
      } else {
        const last = polyDraft.current[polyDraft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 1.0) { bump(); return; }
        polyDraft.current = [...polyDraft.current, p];
      }
      onDrawRef.current?.(true);
      bump();
    };

    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (ev.key === 'Escape') {
        if (polyDraft.current.length || rectDrag.current) {
          ev.preventDefault();
          discard();
        }
        return;
      }
      if (ev.key === 'Enter' && modeRef.current === 'polygon' && polyDraft.current.length >= 3) {
        ev.preventDefault();
        const pts = polyDraft.current;
        polyDraft.current = [];
        onDrawRef.current?.(false);
        const bb = bboxOf(pts);
        onCommitRef.current({ id: `zone-${Date.now()}`, type: typeRef.current, ...bb, polygon: pts });
        bump();
      }
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, camera, gl, raycaster, pointer, ground, hit]);

  useFrame(() => {
    const mesh = previewRect.current;
    const d = rectDrag.current;
    if (mesh) {
      if (d && modeRef.current === 'rect') {
        const minX = Math.min(d.x0, d.x1);
        const maxX = Math.max(d.x0, d.x1);
        const minY = Math.min(d.y0, d.y1);
        const maxY = Math.max(d.y0, d.y1);
        const w = maxX - minX;
        const h = maxY - minY;
        mesh.visible = w > 0.5 && h > 0.5;
        mesh.position.set((minX + maxX) / 2, 0.03, -(minY + maxY) / 2);
        mesh.scale.set(w, 1, h);
        (mesh.material as THREE.MeshBasicMaterial).color.set(ZONE_COLORS[typeRef.current]);
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          typeRef.current === 'boundary' ? 0.08 : 0.35;
      } else {
        mesh.visible = false;
      }
    }

    const group = previewGroup.current;
    if (!group) return;
    while (group.children.length) {
      const c = group.children[0];
      group.remove(c);
      if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
        c.geometry?.dispose();
        (c.material as THREE.Material)?.dispose?.();
      }
    }

    if (modeRef.current === 'rect') return;

    let pts = polyDraft.current.slice();
    if (cursor.current && pts.length >= 1 && modeRef.current === 'polygon') {
      pts = [...pts, cursor.current];
    }
    if (pts.length < 2) return;

    const positions: number[] = [];
    for (const p of pts) positions.push(p.x, 0.04, -p.y);
    if (pts.length >= 3) positions.push(pts[0].x, 0.04, -pts[0].y);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const line = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({ color: ZONE_COLORS[typeRef.current], transparent: true, opacity: 0.9 })
    );
    line.userData.nonPickable = true;
    group.add(line);

    if (pts.length >= 3 && typeRef.current !== 'boundary') {
      try {
        const shape = new THREE.Shape();
        shape.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
        shape.closePath();
        const geom = new THREE.ShapeGeometry(shape);
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, 0.035, 0);
        const m = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({
            color: ZONE_COLORS[typeRef.current],
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        m.userData.nonPickable = true;
        group.add(m);
      } catch { /* ignore */ }
    }
  });

  return (
    <group>
      <mesh ref={previewRect} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.35} depthWrite={false} color={ZONE_COLORS[zoneType]} />
      </mesh>
      <group ref={previewGroup} name="DraftZone" />
    </group>
  );
}

function BoundaryOutline({ zone }: { zone: ZoneRect }) {
  const geom = useMemo(() => {
    const pts: Point2D[] =
      zone.polygon && zone.polygon.length >= 3
        ? zone.polygon
        : [
            { x: zone.minX, y: zone.minY },
            { x: zone.maxX, y: zone.minY },
            { x: zone.maxX, y: zone.maxY },
            { x: zone.minX, y: zone.maxY },
          ];
    const positions: number[] = [];
    for (const p of pts) positions.push(p.x, 0.04, -p.y);
    positions.push(pts[0].x, 0.04, -pts[0].y);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [zone]);

  return (
    <line
      geometry={geom}
      userData={{
        kind: 'zone',
        zoneId: zone.id,
        zoneType: 'boundary',
        nonPickable: false,
        osmTags: { name: zone.name || 'boundary', landuse: 'boundary' },
      }}
    >
      <lineBasicMaterial color={ZONE_COLORS.boundary} transparent opacity={0.95} />
    </line>
  );
}

export function ZoneMeshes({ zones }: { zones: ZoneRect[] }) {
  return (
    <group name="Zones">
      {zones.map((z) => {
        if (z.type === 'boundary') {
          return <BoundaryOutline key={z.id} zone={z} />;
        }

        const color = ZONE_COLORS[z.type];
        // Remount when type/color changes so viewport colour updates immediately
        const meshKey = `${z.id}-${z.type}-${color}`;

        if (z.polygon && z.polygon.length >= 3) {
          const shape = new THREE.Shape();
          shape.moveTo(z.polygon[0].x, z.polygon[0].y);
          for (let i = 1; i < z.polygon.length; i++) {
            shape.lineTo(z.polygon[i].x, z.polygon[i].y);
          }
          shape.closePath();
          return (
            <mesh
              key={meshKey}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.025, 0]}
              userData={{
                kind: 'zone',
                zoneId: z.id,
                zoneType: z.type,
                nonPickable: false,
                osmTags: { name: z.name || z.type, landuse: z.type },
              }}
            >
              <shapeGeometry args={[shape]} />
              <meshBasicMaterial
                key={color}
                color={color}
                transparent
                opacity={0.28}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        }
        const w = z.maxX - z.minX;
        const h = z.maxY - z.minY;
        return (
          <mesh
            key={meshKey}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[(z.minX + z.maxX) / 2, 0.025, -(z.minY + z.maxY) / 2]}
            scale={[w, 1, h]}
            userData={{
              kind: 'zone',
              zoneId: z.id,
              zoneType: z.type,
              nonPickable: false,
              osmTags: { name: z.name || z.type, landuse: z.type },
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              key={color}
              color={color}
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
