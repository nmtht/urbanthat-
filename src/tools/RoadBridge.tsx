import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline, RoadProfileId } from '../domain/roads';
import { getRoadProfile } from '../domain/roads';
import { localToWorld } from '../geometry/roadBuild';
import { offsetPolyline, corridorPolygon, simplifyPolyline } from '../geometry/polylineOffset';

interface Props {
  enabled: boolean;
  profileId: RoadProfileId;
  existingRoads?: RoadCenterline[];
  onCommit: (road: RoadCenterline) => void;
  onDraftChange?: (pts: Point2D[] | null) => void;
}

const SNAP_RADIUS_M = 2.5;
const MIN_SEGMENT_M = 1.0;
const DRAG_SAMPLE_M = 2.5;

/**
 * Road drawing:
 * - Click mode: LMB places vertices; Enter / double-click commits
 * - Drag mode: hold LMB and move — continuous polyline sampled by distance
 * - Esc discards; Backspace drops last vertex
 */
export function RoadBridge({
  enabled,
  profileId,
  existingRoads = [],
  onCommit,
  onDraftChange,
}: Props) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const draft = useRef<Point2D[]>([]);
  const cursor = useRef<Point2D | null>(null);
  const lastClickT = useRef(0);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const previewGroup = useRef<THREE.Group>(null);
  const profileRef = useRef(profileId);
  profileRef.current = profileId;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onDraftRef = useRef(onDraftChange);
  onDraftRef.current = onDraftChange;
  const roadsRef = useRef(existingRoads);
  roadsRef.current = existingRoads;

  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const toLocal = (clientX: number, clientY: number): Point2D | null => {
    const el = gl.domElement;
    const rect = el.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const ok = raycaster.ray.intersectPlane(ground, hit);
    if (!ok) return null;
    return { x: hit.x, y: -hit.z };
  };

  const snapPoint = (p: Point2D): Point2D => {
    let best = p;
    let bestD = SNAP_RADIUS_M;
    for (const road of roadsRef.current) {
      for (const v of road.points) {
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    return best;
  };

  const commitDraft = () => {
    const pts = simplifyPolyline(draft.current, 0.4);
    draft.current = [];
    cursor.current = null;
    dragging.current = false;
    dragMoved.current = false;
    onDraftRef.current?.(null);
    bump();
    if (pts.length < 2) return;
    onCommitRef.current({
      id: `road-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      points: pts,
      profileId: profileRef.current,
    });
  };

  const discardDraft = () => {
    draft.current = [];
    cursor.current = null;
    dragging.current = false;
    dragMoved.current = false;
    onDraftRef.current?.(null);
    bump();
  };

  useEffect(() => {
    if (!enabled) {
      discardDraft();
      gl.domElement.style.cursor = '';
      return;
    }
    gl.domElement.style.cursor = 'crosshair';
    return () => {
      gl.domElement.style.cursor = '';
    };
  }, [enabled, gl]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const p0 = toLocal(ev.clientX, ev.clientY);
      if (!p0) return;
      const p = snapPoint(p0);
      downPos.current = { x: ev.clientX, y: ev.clientY };
      dragging.current = true;
      dragMoved.current = false;

      if (draft.current.length === 0) {
        draft.current = [p];
        onDraftRef.current?.(draft.current.slice());
        bump();
      }
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const p0 = toLocal(ev.clientX, ev.clientY);
      if (!p0) return;
      const p = snapPoint(p0);
      cursor.current = p;

      if (!dragging.current || !downPos.current) return;

      const dx = ev.clientX - downPos.current.x;
      const dy = ev.clientY - downPos.current.y;
      if (Math.hypot(dx, dy) > 6) dragMoved.current = true;

      if (dragMoved.current && draft.current.length >= 1) {
        const last = draft.current[draft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= DRAG_SAMPLE_M) {
          draft.current = [...draft.current, p];
          onDraftRef.current?.(draft.current.slice());
          bump();
        }
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }

      const wasDrag = dragMoved.current;
      dragging.current = false;
      const p0 = toLocal(ev.clientX, ev.clientY);

      if (wasDrag) {
        if (p0 && draft.current.length >= 1) {
          const p = snapPoint(p0);
          const last = draft.current[draft.current.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_SEGMENT_M * 0.5) {
            draft.current = [...draft.current, p];
          }
        }
        if (draft.current.length >= 2) {
          commitDraft();
        } else {
          onDraftRef.current?.(draft.current.slice());
          bump();
        }
        dragMoved.current = false;
        downPos.current = null;
        return;
      }

      dragMoved.current = false;
      downPos.current = null;
      if (!p0) return;
      const p = snapPoint(p0);
      const now = Date.now();
      const isDouble = now - lastClickT.current < 320 && draft.current.length >= 1;
      lastClickT.current = now;

      if (isDouble) {
        if (draft.current.length >= 1) {
          const last = draft.current[draft.current.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_SEGMENT_M * 0.5) {
            draft.current = [...draft.current, p];
          }
        }
        commitDraft();
        return;
      }

      if (draft.current.length === 1) {
        const first = draft.current[0];
        if (Math.hypot(p.x - first.x, p.y - first.y) < MIN_SEGMENT_M) {
          onDraftRef.current?.(draft.current.slice());
          bump();
          return;
        }
        draft.current = [...draft.current, p];
      } else if (draft.current.length > 1) {
        const last = draft.current[draft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_SEGMENT_M) return;
        draft.current = [...draft.current, p];
      } else {
        draft.current = [p];
      }
      onDraftRef.current?.(draft.current.slice());
      bump();
    };

    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (ev.key === 'Escape') {
        if (draft.current.length > 0) {
          ev.preventDefault();
          discardDraft();
        }
        return;
      }
      if (ev.key === 'Enter') {
        if (draft.current.length >= 2) {
          ev.preventDefault();
          commitDraft();
        }
        return;
      }
      if (ev.key === 'Backspace') {
        if (draft.current.length > 0 && !dragging.current) {
          ev.preventDefault();
          draft.current = draft.current.slice(0, -1);
          if (draft.current.length === 0) cursor.current = null;
          onDraftRef.current?.(draft.current.length ? draft.current.slice() : null);
          bump();
        }
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, camera, gl, raycaster, pointer, ground, hit]);

  useFrame(() => {
    const group = previewGroup.current;
    if (!group) return;
    while (group.children.length) {
      const c = group.children[0];
      group.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose();
        (c.material as THREE.Material)?.dispose?.();
      }
      if (c instanceof THREE.Line) {
        c.geometry?.dispose();
        (c.material as THREE.Material)?.dispose?.();
      }
    }

    const pts = draft.current.slice();
    if (cursor.current && pts.length >= 1) {
      const last = pts[pts.length - 1];
      if (Math.hypot(cursor.current.x - last.x, cursor.current.y - last.y) > 0.3) {
        pts.push(cursor.current);
      }
    }

    if (pts.length < 2) {
      for (const p of draft.current) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 10, 8),
          new THREE.MeshBasicMaterial({ color: '#5ac8fa', depthTest: false })
        );
        const w = localToWorld(p, 0.15);
        m.position.set(w.x, w.y, w.z);
        m.renderOrder = 10;
        group.add(m);
      }
      return;
    }

    const profile = getRoadProfile(profileRef.current);
    const half = profile.widthM / 2;
    const clean = simplifyPolyline(pts, 0.4);
    const { left, right } = offsetPolyline(clean, half, 2.5);
    const poly = corridorPolygon(left, right);
    if (poly.length >= 3) {
      const shape = new THREE.Shape();
      shape.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, poly[i].y);
      shape.closePath();
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, 0.07, 0);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({
          color: profile.asphaltColor,
          transparent: true,
          opacity: 0.7,
          roughness: 0.85,
          depthWrite: false,
        })
      );
      mesh.userData.nonPickable = true;
      group.add(mesh);
    }

    const positions: number[] = [];
    for (const p of clean) {
      const w = localToWorld(p, 0.12);
      positions.push(w.x, w.y, w.z);
    }
    if (positions.length >= 6) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: '#5ac8fa', transparent: true, opacity: 0.85 })
      );
      line.userData.nonPickable = true;
      group.add(line);
    }

    for (const p of draft.current) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#5ac8fa', depthTest: false })
      );
      const w = localToWorld(p, 0.15);
      m.position.set(w.x, w.y, w.z);
      m.renderOrder = 10;
      group.add(m);
    }
  });

  return <group ref={previewGroup} name="DraftRoad" />;
}
