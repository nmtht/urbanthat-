import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Sky, Stars } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GroundPlane } from './render/GroundPlane';
import { ImportMapDialog } from './ui/ImportMapDialog';
import { Toolbar, type ToolId } from './ui/Toolbar';
import { SelectionBridge, type SelectedOsm } from './tools/SelectionBridge';
import { ZoneBridge, ZoneMeshes } from './tools/ZoneBridge';
import type { ZoneRect, ZoneType } from './domain/zones';
import { CommandStack, DeleteOsmCommand, AddZoneCommand } from './state/commandStack';
import { StatusChip } from './ui/StatusChip';
import { EmptyState } from './ui/EmptyState';
import { ScenePanel, type OsmQuality } from './ui/ScenePanel';
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

function sunFromHour(hour: number): THREE.Vector3 {
  const t = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.sin(t);
  const azimuth = ((hour - 12) / 12) * Math.PI;
  const y = Math.max(elevation, -0.05);
  const x = Math.cos(azimuth);
  const z = Math.sin(azimuth) * 0.65;
  return new THREE.Vector3(x, y, z).normalize().multiplyScalar(100);
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

function Atmosphere({ hour }: { hour: number }) {
  const { scene, camera, gl } = useThree();
  const sun = useMemo(() => sunFromHour(hour), [hour]);
  const elev = sun.y;
  const isNight = elev < 8;

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.near = 0.5;
    cam.far = 80_000;
    cam.updateProjectionMatrix();
    if (isNight) {
      scene.background = new THREE.Color('#070a10');
      scene.fog = new THREE.FogExp2(0x070a10, 0.00012);
      gl.setClearColor('#070a10');
    } else {
      const horizon = elev < 28 ? 0xc4a888 : 0xc5d6ea;
      scene.background = null;
      scene.fog = new THREE.FogExp2(horizon, elev < 28 ? 0.0001 : 0.00006);
      gl.setClearColor(horizon);
    }
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [isNight, elev, scene, camera, gl]);

  if (isNight) {
    return (
      <>
        <ambientLight intensity={0.2} />
        <directionalLight position={[sun.x, Math.max(Math.abs(sun.y), 30), sun.z]} intensity={0.12} color="#a8b4c8" />
        <Stars radius={600} depth={120} count={6000} factor={3.5} saturation={0} fade speed={0.3} />
      </>
    );
  }
  const dusk = elev < 28;
  return (
    <>
      <Sky distance={450_000} sunPosition={[sun.x, sun.y, sun.z]} turbidity={dusk ? 8 : 3.2} rayleigh={dusk ? 2.4 : 1.0} mieCoefficient={dusk ? 0.012 : 0.004} mieDirectionalG={0.85} />
      <ambientLight intensity={dusk ? 0.32 : 0.5} color={dusk ? '#ffd0b0' : '#ffffff'} />
      <directionalLight position={[sun.x, sun.y, sun.z]} intensity={dusk ? 0.9 : 1.25} color={dusk ? '#ff9a5c' : '#fff5e6'} />
      <hemisphereLight args={[dusk ? '#ffb070' : '#d0e4f8', '#3c3c38', dusk ? 0.45 : 0.4]} />
    </>
  );
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
  if (kind === 'road') {
    return {
      kind: 'road',
      label: tags.name ?? tags.highway ?? 'road',
      detail: tags.name ? tags.highway : tags.lanes ? `${tags.lanes} lanes` : undefined,
    };
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmState | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [zones, setZones] = useState<ZoneRect[]>([]);
  const [zoneType, setZoneType] = useState<ZoneType>('residential');
  const [selected, setSelected] = useState<SelectedOsm | null>(null);
  const [undoTick, setUndoTick] = useState(0);
  const cmdStack = useRef(new CommandStack());
  useEffect(() => cmdStack.current.subscribe(() => setUndoTick((n) => n + 1)), []);
  const [hour, setHour] = useState(14);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [quality, setQuality] = useState<OsmQuality>('med');
  const [showTrees, setShowTrees] = useState(true);
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
  }, [hour]);

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
        const built = buildOsmContextLayer(data, origin, bbox, { quality, showTrees });

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
        setSelected(null);
        setZones([]);
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
    [clearOsm, quality, showTrees, hour]
  );

  const handleRefresh = useCallback(() => {
    if (lastBbox.current) handleImport(lastBbox.current);
  }, [handleImport]);

  const performDelete = useCallback((sel: SelectedOsm) => {
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
      if ((ev.key === 'z' || ev.key === 'Z') && !(ev.metaKey || ev.ctrlKey)) {
        setTool('zone');
        return;
      }
      if (ev.key === '1') {
        setZoneType('residential');
        setTool('zone');
        return;
      }
      if (ev.key === '2') {
        setZoneType('commercial');
        setTool('zone');
        return;
      }
      if (ev.key === '3') {
        setZoneType('industrial');
        setTool('zone');
        return;
      }
      if (ev.key === '4') {
        setZoneType('park');
        setTool('zone');
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
  }, [selected, performDelete]);

  useEffect(() => {
    if (!osm) return;
    osm.group.traverse((obj) => {
      if (obj.userData?.kind === 'tree') obj.visible = showTrees;
    });
  }, [showTrees, osm]);

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

  const openImport = () => {
    setError(null);
    setDialogOpen(true);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [80, 60, 80], fov: 45, near: 0.5, far: 80_000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#1c1c1e' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#c5d6ea');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Atmosphere hour={hour} />
        <Suspense fallback={null}>{!osm && <GroundPlane size={400} />}</Suspense>
        <group>{osm && <primitive object={osm.group} />}</group>
        {showGrid && <gridHelper args={[2000, 40, '#3a3a3c', '#2c2c2e']} position={[0, 0.02, 0]} />}
        <ZoneMeshes zones={zones} />
        <ZoneBridge
          enabled={!!osm && tool === 'zone'}
          zoneType={zoneType}
          onCommit={(z) => cmdStack.current.push(new AddZoneCommand(z, setZones))}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={12_000}
          maxPolarAngle={Math.PI / 2.02}
        />
        <CameraFit target={fitTarget} fitKey={fitKey} />
        <CameraYawReporter onYaw={onYaw} />
        <PickBridge enabled={!!osm && (tool === 'select' || tool === 'delete')} onHover={handleHover} />
        <SelectionBridge
          tool={tool}
          enabled={!!osm && (tool === 'select' || tool === 'delete')}
          selected={selected}
          onSelect={setSelected}
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
          <button type="button" style={hud.btn} onClick={() => setSceneOpen((v) => !v)} title="Scene settings">
            Scene
          </button>
        </div>
      </div>

      <Toolbar active={tool} onChange={setTool} onImport={openImport} disabled={loading} />
      {tool === 'zone' && (
        <div style={hud.zoneBar}>
          {(['residential', 'commercial', 'industrial', 'park'] as ZoneType[]).map((zt) => (
            <button
              key={zt}
              type="button"
              style={{ ...hud.zoneBtn, ...(zoneType === zt ? hud.zoneBtnOn : null) }}
              onClick={() => setZoneType(zt)}
            >
              {zt.slice(0, 3)}
            </button>
          ))}
          <span style={hud.zoneHint}>drag · 1-4</span>
        </div>
      )}
      {!osm && !loading && !dialogOpen && <EmptyState onImport={openImport} />}

      <ScenePanel
        open={sceneOpen}
        onClose={() => setSceneOpen(false)}
        hour={hour}
        onHour={setHour}
        quality={quality}
        onQuality={setQuality}
        showTrees={showTrees}
        onShowTrees={setShowTrees}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        showNorth={showNorth}
        onShowNorth={setShowNorth}
        units={units}
        onUnits={setUnits}
      />

      <NorthArrow visible={showNorth && !!osm} yawDeg={yawDeg} />
      <HoverHud info={hover.info} x={hover.x} y={hover.y} />

      {osm && (
        <div
          key={undoTick}
          style={hud.undo}
          title={cmdStack.current.lastLabel ? `Undo: ${cmdStack.current.lastLabel} (Cmd+Z)` : 'Nothing to undo'}
        >
          {'\u2304'} {cmdStack.current.undoCount}
          {selected ? ` \u00b7 ${selected.label}` : ''}
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
  zoneBar: {
    position: 'absolute',
    bottom: 88,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 12,
    background: 'rgba(28,28,30,0.82)',
    backdropFilter: 'blur(16px)',
    zIndex: 22,
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
