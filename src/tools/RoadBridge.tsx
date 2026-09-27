import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Point2D } from '../domain/SceneOrigin';
import type { RoadCenterline, RoadProfileId, RoadOptions, DrawMode } from '../domain/roads';
import { resolveRoadGeometry } from '../domain/roads';
import { localToWorld } from '../geometry/roadBuild';
import { offsetPolyline, corridorPolygon, simplifyPolyline } from '../geometry/polylineOffset';

interface Props {
  enabled: boolean;
  profileId: RoadProfileId;
  options?: RoadOptions;
  drawMode: DrawMode;
  existingRoads?: RoadCenterline[];
  onCommit: (road: RoadCenterline) => void;
  onDraftChange?: (pts: Point2D[] | null) => void;
  onDrawingActive?: (active: boolean) => void;
}

const SNAP_RADIUS_M = 3.0;
const MIN_SEGMENT_M = 1.0;
const DRAG_SAMPLE_M = 2.0;

function bezier2(a: Point2D, b: Point2D, c: Point2D, n = 16): Point2D[] {
  const out: Point2D[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    });
  }
  return out;
}

export function RoadBridge({
  enabled,
  profileId,
  options,
  drawMode,
  existingRoads = [],
  onCommit,
  onDraftChange,
  onDrawingActive,
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
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const modeRef = useRef(drawMode);
  modeRef.current = drawMode;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onDraftRef = useRef(onDraftChange);
  onDraftRef.current = onDraftChange;
  const onDrawRef = useRef(onDrawingActive);
  onDrawRef.current = onDrawingActive;
  const roadsRef = useRef(existingRoads);
  roadsRef.current = existingRoads;

  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const setDrawing = (v: boolean) => onDrawRef.current?.(v);

  const toLocal = (clientX: number, clientY: number): Point2D | null => {
    const el = gl.domElement;
    const rect = el.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
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

  const commitPts = (raw: Point2D[]) => {
    const pts = simplifyPolyline(raw, modeRef.current === 'freehand' ? 0.6 : 0.3);
    draft.current = [];
    cursor.current = null;
    dragging.current = false;
    dragMoved.current = false;
    setDrawing(false);
    onDraftRef.current?.(null);
    bump();
    if (pts.length < 2) return;
    onCommitRef.current({
      id: `road-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      points: pts,
      profileId: profileRef.current,
      options: optionsRef.current,
    });
  };

  const discardDraft = () => {
    draft.current = [];
    cursor.current = null;
    dragging.current = false;
    dragMoved.current = false;
    setDrawing(false);
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
    discardDraft();
  }, [drawMode]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const p0 = toLocal(ev.clientX, ev.clientY);
      if (!p0) return;
      const p = snapPoint(p0);
      downPos.current = { x: ev.clientX, y: ev.clientY };
      dragging.current = true;
      dragMoved.current = false;
      setDrawing(true);

      const mode = modeRef.current;
      if (mode === 'freehand') {
        draft.current = [p];
        onDraftRef.current?.(draft.current.slice());
        bump();
      } else if (draft.current.length === 0) {
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

      if (!dragging.current || !downPos.current) {
        bump();
        return;
      }

      const dx = ev.clientX - downPos.current.x;
      const dy = ev.clientY - downPos.current.y;
      if (Math.hypot(dx, dy) > 5) dragMoved.current = true;

      if (modeRef.current === 'freehand' && dragMoved.current && draft.current.length >= 1) {
        const last = draft.current[draft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= DRAG_SAMPLE_M) {
          draft.current = [...draft.current, p];
          onDraftRef.current?.(draft.current.slice());
          bump();
        }
      } else {
        bump();
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }

      const mode = modeRef.current;
      const wasDrag = dragMoved.current;
      dragging.current = false;
      const p0 = toLocal(ev.clientX, ev.clientY);

      if (mode === 'freehand') {
        if (wasDrag && p0 && draft.current.length >= 1) {
          const p = snapPoint(p0);
          const last = draft.current[draft.current.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_SEGMENT_M * 0.4) {
            draft.current = [...draft.current, p];
          }
        }
        if (draft.current.length >= 2) commitPts(draft.current);
        else discardDraft();
        dragMoved.current = false;
        downPos.current = null;
        return;
      }

      dragMoved.current = false;
      downPos.current = null;
      if (!p0) {
        if (draft.current.length === 0) setDrawing(false);
        return;
      }
      const p = snapPoint(p0);
      const now = Date.now();
      const isDouble = now - lastClickT.current < 320 && draft.current.length >= 1;
      lastClickT.current = now;

      if (mode === 'curve') {
        if (draft.current.length === 0) {
          draft.current = [p];
        } else if (draft.current.length === 1) {
          if (Math.hypot(p.x - draft.current[0].x, p.y - draft.current[0].y) < MIN_SEGMENT_M) {
            bump();
            return;
          }
          draft.current = [...draft.current, p];
        } else if (draft.current.length === 2) {
          if (Math.hypot(p.x - draft.current[1].x, p.y - draft.current[1].y) < MIN_SEGMENT_M) {
            bump();
            return;
          }
          commitPts(bezier2(draft.current[0], draft.current[1], p, 20));
          return;
        }
        onDraftRef.current?.(draft.current.slice());
        bump();
        return;
      }

      if (isDouble) {
        if (draft.current.length >= 1) {
          const last = draft.current[draft.current.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_SEGMENT_M * 0.5) {
            draft.current = [...draft.current, p];
          }
        }
        if (draft.current.length >= 2) commitPts(draft.current);
        else discardDraft();
        return;
      }

      if (draft.current.length === 0) {
        draft.current = [p];
      } else {
        const last = draft.current[draft.current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_SEGMENT_M) {
          bump();
          return;
        }
        draft.current = [...draft.current, p];
      }
      setDrawing(true);
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
          if (modeRef.current === 'curve' && draft.current.length === 2 && cursor.current) {
            commitPts(bezier2(draft.current[0], draft.current[1], cursor.current, 20));
          } else {
            commitPts(draft.current);
          }
        }
        return;
      }
      if (ev.key === 'Backspace') {
        if (draft.current.length > 0 && !dragging.current) {
          ev.preventDefault();
          draft.current = draft.current.slice(0, -1);
          if (draft.current.length === 0) {
            cursor.current = null;
            setDrawing(false);
          }
          onDraftRef.current?.(draft.current.length ? draft.current.slice() : null);
          bump();
        }
      }
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerUp, true);
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

    let pts = draft.current.slice();
    const mode = modeRef.current;

    if (mode === 'curve' && pts.length === 2 && cursor.current) {
      pts = bezier2(pts[0], pts[1], cursor.current, 16);
    } else if (cursor.current && pts.length >= 1 && mode !== 'curve') {
      const last = pts[pts.length - 1];
      if (Math.hypot(cursor.current.x - last.x, cursor.current.y - last.y) > 0.3) {
        pts = [...pts, cursor.current];
      }
    } else if (mode === 'curve' && pts.length === 1 && cursor.current) {
      pts = [...pts, cursor.current];
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

    const resolved = resolveRoadGeometry(profileRef.current, optionsRef.current);
    const half = resolved.carriageWidthM / 2;
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
          color: resolved.profile.asphaltColor,
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
