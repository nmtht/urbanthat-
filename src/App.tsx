import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { ImportMapDialog } from './ui/ImportMapDialog';
import { Toolbar, type ToolId } from './ui/Toolbar';
import { SelectionBridge, type SelectedOsm } from './tools/SelectionBridge';
import { ZoneBridge, ZoneMeshes } from './tools/ZoneBridge';
import { RoadBridge } from './tools/RoadBridge';
import { UserRoadsLayer } from './render/UserRoadsLayer';
import type { ZoneRect, ZoneType } from './domain/zones';
import type { RoadCenterline, RoadProfileId, RoadOptions, DrawMode, ZoneDrawMode } from './domain/roads';
import { ROAD_PROFILE_ORDER, ROAD_PROFILES, getRoadProfile } from './domain/roads';
import {
  CommandStack,
  DeleteOsmCommand,
  AddZoneCommand,
  AddRoadCommand,
  DeleteRoadCommand,
} from './state/commandStack';
import { StatusChip } from './ui/StatusChip';
import { EmptyState } from './ui/EmptyState';
import { ScenePanel, type ModelQuality } from './ui/ScenePanel';
import { InspectorPanel, type InspectorTarget } from './ui/InspectorPanel';
import { computeSceneStats } from './domain/stats';
import { HoverHud, type HoverInfo } from './ui/HoverHud';
import { NorthArrow } from './ui/NorthArrow';
import {
  createSceneOrigin,
  bboxCenter,
  type BBox,
  type SceneOrigin,
} from './domain/SceneOrigin';
import { fetchOsmFragment, OverpassError } from './osm/overpassClient';
import {
  buildOsmContextLayer,
  disposeOsmContextLayer,
} from './osm/osmContextLayer';
import { setFacadeNightFactor, clearFacadeCache } from './render/buildingFacades';
import { Atmosphere, nightFactorFromHour } from './render/Atmosphere';

interface OsmState {
  origin: SceneOrigin;
  group: THREE.Group;
  buildingCount: number;
  roadCount: number;
  waterCount: number;
  greenCount: number;
  treeCount: number;
  bbox: BBox;
}

function CameraFit({
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

function CameraYawReporter({ onYaw }: { onYaw: (deg: number) => void }) {
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

function PickBridge({
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

export default function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startedEmpty, setStartedEmpty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmState | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [zones, setZones] = useState<ZoneRect[]>([]);
  const [zoneType, setZoneType] = useState<ZoneType>('residential');
  const [userRoads, setUserRoads] = useState<RoadCenterline[]>([]);
  const [roadProfile, setRoadProfile] = useState<RoadProfileId>('residential');
  const [roadOptions, setRoadOptions] = useState<RoadOptions>({});
  const [roadDrawMode, setRoadDrawMode] = useState<DrawMode>('straight');
  const [zoneDrawMode, setZoneDrawMode] = useState<ZoneDrawMode>('rect');
  const [roadDraftPts, setRoadDraftPts] = useState<number | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const [selected, setSelected] = useState<SelectedOsm | null>(null);
  const [undoTick, setUndoTick] = useState(0);
  const cmdStack = useRef(new CommandStack());
  useEffect(() => cmdStack.current.subscribe(() => setUndoTick((n) => n + 1)), []);
  const [hour, setHour] = useState(14);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [quality, setQuality] = useState<ModelQuality>('med');
  const [fogAmount, setFogAmount] = useState(0.35);
  const [showGrid, setShowGrid] = useState(false);
  const [showNorth, setShowNorth] = useState(true);
  const [units, setUnits] = useState<'m' | 'ft'>('m');
  const [hover, setHover] = useState<{ info: HoverInfo | null; x: number; y: number }>({
    info: null,
    x: 0,
    y: 0,
  });
  const [yawDeg, setYawDeg] = useState(0);
  const onYaw = useCallback((d: number) => setYawDeg(d), []);
  const handleHover = useCallback((info: HoverInfo | null, x: number, y: number) => {
    setHover((prev) => {
      if (!info && !prev.info) return prev;
      if (
        info &&
        prev.info &&
        info.label === prev.info.label &&
        info.kind === prev.info.kind &&
        Math.abs(x - prev.x) < 4 &&
        Math.abs(y - prev.y) < 4
      ) {
        return prev;
      }
      return { info, x, y };
    });
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const lastBbox = useRef<BBox | null>(null);

  useEffect(() => {
    setFacadeNightFactor(hour);
    const night = nightFactorFromHour(hour);
    if (osm) {
      osm.group.traverse((obj) => {
        if (obj.userData?.kind === 'street-lamp-light' && obj instanceof THREE.PointLight) {
          const base = (obj.userData.baseIntensity as number) ?? 1.2;
          obj.intensity = base * night;
        }
        if (obj.userData?.kind === 'street-lamp-head' && obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat?.emissiveIntensity != null) mat.emissiveIntensity = 0.15 + night * 0.85;
        }
      });
    }
  }, [hour, osm]);

  const clearOsm = useCallback(() => {
    setOsm((prev) => {
      if (prev) disposeOsmContextLayer(prev.group);
      return null;
    });
  }, []);

  const handleImport = useCallback(
    async (bbox: BBox) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      lastBbox.current = bbox;

      try {
        const data = await fetchOsmFragment(bbox, { signal: ac.signal });
        const center = bboxCenter(bbox);
        const origin = createSceneOrigin(center.lat, center.lon);
        const built = buildOsmContextLayer(data, origin, bbox, { quality });

        clearOsm();
        setOsm({
          origin,
          group: built.group,
          buildingCount: built.buildingCount,
          roadCount: built.roadCount,
          waterCount: built.waterCount,
          greenCount: built.greenCount,
          treeCount: built.treeCount,
          bbox,
        });
        setDialogOpen(false);
        setStartedEmpty(true);
        setSelected(null);
        setZones([]);
        setUserRoads([]);
        cmdStack.current.clear();
        setFacadeNightFactor(hour);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg =
          err instanceof OverpassError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Import failed';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [clearOsm, quality, hour]
  );

  const handleRefresh = useCallback(() => {
    if (lastBbox.current) handleImport(lastBbox.current);
  }, [handleImport]);

  const userRoadsRef = useRef(userRoads);
  userRoadsRef.current = userRoads;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const performDelete = useCallback((sel: SelectedOsm) => {
    if (sel.kind === 'user-road') {
      const roadId =
        sel.roadId ??
        (sel.object.userData?.roadId as string | undefined) ??
        (sel.object.parent?.userData?.roadId as string | undefined);
      if (roadId) {
        const road = userRoadsRef.current.find((r) => r.id === roadId);
        if (road) cmdStack.current.push(new DeleteRoadCommand(road, setUserRoads));
      }
      setSelected(null);
      return;
    }
    if (sel.kind === 'zone') {
      const zoneId = sel.zoneId ?? (sel.object.userData?.zoneId as string | undefined);
      if (zoneId) setZones((prev) => prev.filter((z) => z.id !== zoneId));
      setSelected(null);
      return;
    }
    const targets = sel.objects?.length ? sel.objects : [sel.object];
    cmdStack.current.push(
      new DeleteOsmCommand(
        targets,
        targets.length > 1 ? `${sel.kind} x${targets.length}` : sel.kind
      )
    );
    setSelected(null);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (ev.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (ev.key === 'v' || ev.key === 'V') {
        setTool('select');
        return;
      }
      if (ev.key === 'x' || ev.key === 'X') {
        setTool('delete');
        return;
      }
      if (ev.key === 'r' || ev.key === 'R') {
        if (!(ev.metaKey || ev.ctrlKey)) {
          setTool('road');
          return;
        }
      }
      if ((ev.key === 'z' || ev.key === 'Z') && !(ev.metaKey || ev.ctrlKey)) {
        setTool('zone');
        return;
      }
      if (ev.key === '1' || ev.key === '2' || ev.key === '3' || ev.key === '4' || ev.key === '5') {
        const n = parseInt(ev.key, 10);
        if (tool === 'road') {
          const pid = ROAD_PROFILE_ORDER[n - 1];
          if (pid) setRoadProfile(pid);
          return;
        }
        const zmap: Record<string, ZoneType> = {
          '1': 'residential',
          '2': 'commercial',
          '3': 'industrial',
          '4': 'park',
          '5': 'boundary',
        };
        if (zmap[ev.key]) {
          setZoneType(zmap[ev.key]);
          setTool('zone');
        }
        return;
      }
      if ((ev.key === 'z' || ev.key === 'Z') && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        if (ev.shiftKey) cmdStack.current.redo();
        else cmdStack.current.undo();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selected) {
          ev.preventDefault();
          performDelete(selected);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, performDelete, tool]);

  const qualityRef = useRef(quality);
  useEffect(() => {
    if (qualityRef.current === quality) return;
    qualityRef.current = quality;
    if (!lastBbox.current) return;
    clearFacadeCache();
    handleImport(lastBbox.current);
  }, [quality, handleImport]);

  const fitKey = osm ? `${osm.bbox.south},${osm.bbox.west},${osm.buildingCount}` : null;
  const fitTarget = useMemo(() => {
    if (!osm) return null;
    const box = new THREE.Box3().setFromObject(osm.group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.z, 40) * 0.5;
    return { x: center.x, z: center.z, radius };
  }, [osm]);

  const inspectorTarget: InspectorTarget | null = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'user-road') {
      const id = selected.roadId ?? (selected.object.userData?.roadId as string | undefined);
      const road = userRoads.find((r) => r.id === id);
      if (road) return { kind: 'user-road', road };
    }
    if (selected.kind === 'zone') {
      const id = selected.zoneId ?? (selected.object.userData?.zoneId as string | undefined);
      const zone = zones.find((z) => z.id === id);
      if (zone) return { kind: 'zone', zone };
    }
    if (selected.kind === 'building' || selected.kind === 'road') {
      const tags = (selected.object.userData?.osmTags ?? {}) as Record<string, string>;
      return { kind: 'osm', label: selected.label, osmKind: selected.kind, tags };
    }
    return null;
  }, [selected, userRoads, zones]);

  const sceneStats = useMemo(() => computeSceneStats(userRoads, zones), [userRoads, zones]);

  const openImport = () => {
    setError(null);
    setDialogOpen(true);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [80, 60, 80], fov: 45, near: 0.5, far: 80_000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#c5d6ea' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#c5d6ea');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Atmosphere hour={hour} fogAmount={fogAmount} />
        <group>{osm && <primitive object={osm.group} />}</group>
        {showGrid && <gridHelper args={[2000, 40, '#3a3a3c', '#2c2c2e']} position={[0, 0.02, 0]} />}
        <ZoneMeshes zones={zones} />
        <UserRoadsLayer roads={userRoads} />
        <ZoneBridge
          enabled={tool === 'zone'}
          zoneType={zoneType}
          drawMode={zoneDrawMode}
          onCommit={(z) => cmdStack.current.push(new AddZoneCommand(z, setZones))}
          onDrawingActive={setDrawingActive}
        />
        <RoadBridge
          enabled={tool === 'road'}
          profileId={roadProfile}
          options={roadOptions}
          drawMode={roadDrawMode}
          existingRoads={userRoads}
          onCommit={(r) => cmdStack.current.push(new AddRoadCommand(r, setUserRoads))}
          onDraftChange={(pts) => setRoadDraftPts(pts ? pts.length : null)}
          onDrawingActive={setDrawingActive}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={12_000}
          maxPolarAngle={Math.PI / 2.02}
          enabled={!drawingActive}
        />
        <CameraFit target={fitTarget} fitKey={fitKey} />
        <CameraYawReporter onYaw={onYaw} />
        <PickBridge enabled={tool === 'select' || tool === 'delete'} onHover={handleHover} />
        <SelectionBridge
          tool={tool}
          enabled={tool === 'select' || tool === 'delete'}
          selected={selected}
          onSelect={(sel) => {
            setSelected(sel);
            if (sel) setSceneOpen(false);
          }}
          onDeleteClick={performDelete}
        />
      </Canvas>

      <div style={hud.top}>
        <StatusChip
          counts={
            osm
              ? {
                  buildingCount: osm.buildingCount,
                  roadCount: osm.roadCount,
                  waterCount: osm.waterCount,
                  greenCount: osm.greenCount,
                  treeCount: osm.treeCount,
                }
              : null
          }
          loading={loading}
          message="Urban That"
        />
        <div style={hud.topRight}>
          {osm && (
            <button type="button" style={hud.btn} onClick={handleRefresh} disabled={loading}>
              Refresh
            </button>
          )}
          <button
            type="button"
            style={hud.btn}
            onClick={() => {
              setSelected(null);
              setSceneOpen((v) => !v);
            }}
            title="Scene settings"
          >
            Scene
          </button>
        </div>
      </div>

      <Toolbar active={tool} onChange={setTool} onImport={openImport} disabled={loading} />

      {tool === 'zone' && (
        <div style={hud.toolPanel}>
          <div style={hud.zoneBar}>
            {(['residential', 'commercial', 'industrial', 'park', 'boundary'] as ZoneType[]).map(
              (zt) => (
                <button
                  key={zt}
                  type="button"
                  style={{ ...hud.zoneBtn, ...(zoneType === zt ? hud.zoneBtnOn : null) }}
                  onClick={() => setZoneType(zt)}
                >
                  {zt === 'boundary' ? 'Bnd' : zt.slice(0, 3)}
                </button>
              )
            )}
            <span style={hud.sep} />
            {(
              [
                ['rect', 'Rect'],
                ['polygon', 'Poly'],
                ['freehand', 'Free'],
              ] as [ZoneDrawMode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                style={{ ...hud.zoneBtn, ...(zoneDrawMode === m ? hud.zoneBtnOn : null) }}
                onClick={() => setZoneDrawMode(m)}
              >
                {label}
              </button>
            ))}
            <span style={hud.zoneHint}>
              {zoneDrawMode === 'rect'
                ? 'drag rectangle'
                : zoneDrawMode === 'polygon'
                  ? 'click · Enter'
                  : 'hold-drag outline'}
            </span>
          </div>
        </div>
      )}

      {tool === 'road' && (
        <div style={hud.toolPanel}>
          <div style={hud.zoneBar}>
            {ROAD_PROFILE_ORDER.map((pid) => (
              <button
                key={pid}
                type="button"
                style={{ ...hud.zoneBtn, ...(roadProfile === pid ? hud.zoneBtnOn : null) }}
                onClick={() => {
                  setRoadProfile(pid);
                  setRoadOptions({});
                }}
                title={ROAD_PROFILES[pid].label}
              >
                {ROAD_PROFILES[pid].label.slice(0, 3)}
              </button>
            ))}
            <span style={hud.sep} />
            {(
              [
                ['straight', 'Straight'],
                ['curve', 'Curve'],
                ['freehand', 'Free'],
              ] as [DrawMode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                style={{ ...hud.zoneBtn, ...(roadDrawMode === m ? hud.zoneBtnOn : null) }}
                onClick={() => setRoadDrawMode(m)}
              >
                {label}
              </button>
            ))}
            <span style={hud.zoneHint}>
              {roadDraftPts != null
                ? `${roadDraftPts} pts · Enter`
                : roadDrawMode === 'straight'
                  ? 'click · Enter'
                  : roadDrawMode === 'curve'
                    ? '3 clicks'
                    : 'hold-drag'}
            </span>
          </div>
          <div style={hud.zoneBar}>
            <label style={hud.optLabel}>
              Lanes
              <select
                style={hud.select}
                value={roadOptions.lanes ?? getRoadProfile(roadProfile).lanes}
                onChange={(e) =>
                  setRoadOptions((o) => ({ ...o, lanes: parseInt(e.target.value, 10) }))
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.parkingM ?? 0) > 0}
                onChange={(e) =>
                  setRoadOptions((o) => ({ ...o, parkingM: e.target.checked ? 2.2 : 0 }))
                }
              />
              Parking
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.greenBufferM ?? 0) > 0}
                onChange={(e) =>
                  setRoadOptions((o) => ({ ...o, greenBufferM: e.target.checked ? 1.5 : 0 }))
                }
              />
              Green
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.sidewalkM ?? getRoadProfile(roadProfile).sidewalkM) > 0}
                onChange={(e) =>
                  setRoadOptions((o) => ({
                    ...o,
                    sidewalkM: e.target.checked
                      ? getRoadProfile(roadProfile).sidewalkM || 1.5
                      : 0,
                  }))
                }
              />
              Sidewalk
            </label>
          </div>
        </div>
      )}

      {!osm && !loading && !dialogOpen && !startedEmpty && (
        <EmptyState onImport={openImport} onStartEmpty={() => setStartedEmpty(true)} />
      )}

      <ScenePanel
        open={sceneOpen && !inspectorTarget}
        onClose={() => setSceneOpen(false)}
        hour={hour}
        onHour={setHour}
        quality={quality}
        onQuality={setQuality}
        fogAmount={fogAmount}
        onFogAmount={setFogAmount}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        showNorth={showNorth}
        onShowNorth={setShowNorth}
        units={units}
        onUnits={setUnits}
        stats={sceneStats}
      />

      <InspectorPanel
        target={inspectorTarget}
        units={units}
        onClose={() => setSelected(null)}
        onUpdateRoad={(id, patch) => {
          setUserRoads((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, ...patch, options: patch.options ?? r.options } : r
            )
          );
        }}
        onUpdateZone={(id, patch) => {
          setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
        }}
      />

      <NorthArrow visible={showNorth && !!osm} yawDeg={yawDeg} />
      <HoverHud info={hover.info} x={hover.x} y={hover.y} />

      {(osm || userRoads.length > 0 || zones.length > 0) && (
        <div
          key={undoTick}
          style={hud.undo}
          title={
            cmdStack.current.lastLabel
              ? `Undo: ${cmdStack.current.lastLabel} (Cmd+Z)`
              : 'Nothing to undo'
          }
        >
          {'\u2304'} {cmdStack.current.undoCount}
          {selected ? ` · ${selected.label}` : ''}
        </div>
      )}

      <ImportMapDialog
        open={dialogOpen}
        onClose={() => !loading && setDialogOpen(false)}
        onImport={handleImport}
        loading={loading}
        error={error}
      />
    </div>
  );
}

const hud: Record<string, CSSProperties> = {
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    pointerEvents: 'none',
    zIndex: 20,
  },
  topRight: { display: 'flex', gap: 8, pointerEvents: 'auto' },
  btn: {
    pointerEvents: 'auto',
    border: 'none',
    borderRadius: 8,
    padding: '6px 12px',
    background: 'rgba(44,44,46,0.72)',
    color: '#f5f5f7',
    fontSize: 13,
    fontFamily: '-apple-system, system-ui, sans-serif',
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
  },
  toolPanel: {
    position: 'absolute',
    bottom: 88,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 22,
    alignItems: 'center',
    pointerEvents: 'auto',
  },
  zoneBar: {
    position: 'relative',
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 12,
    background: 'rgba(28,28,30,0.82)',
    backdropFilter: 'blur(16px)',
  },
  sep: {
    width: 1,
    height: 18,
    background: 'rgba(255,255,255,0.15)',
    margin: '0 4px',
  },
  optLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: '-apple-system, system-ui, sans-serif',
    cursor: 'pointer',
  },
  select: {
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    fontSize: 11,
    padding: '2px 4px',
  },
  zoneBtn: {
    border: 'none',
    borderRadius: 8,
    padding: '6px 10px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontFamily: '-apple-system, system-ui, sans-serif',
    cursor: 'pointer',
    textTransform: 'capitalize',
  },
  zoneBtnOn: {
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
  },
  zoneHint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    marginLeft: 4,
    fontFamily: '-apple-system, system-ui, sans-serif',
  },
  undo: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    padding: '6px 10px',
    borderRadius: 8,
    background: 'rgba(44,44,46,0.6)',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontFamily: '-apple-system, system-ui, sans-serif',
    pointerEvents: 'none',
    zIndex: 18,
  },
};
