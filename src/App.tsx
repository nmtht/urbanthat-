import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Sky, Stars } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GroundPlane } from './render/GroundPlane';
import { ImportMapDialog } from './ui/ImportMapDialog';
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
  const r = 120;
  const y = Math.max(elevation, -0.15) * 80;
  const x = Math.cos(azimuth) * r;
  const z = Math.sin(azimuth) * r * 0.6;
  return new THREE.Vector3(x, y, z);
}

function CameraFit({
  target,
}: {
  target: { x: number; z: number; radius: number } | null;
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
  }, [target, camera, controls]);
  return null;
}

function Environment({ hour }: { hour: number }) {
  const sun = useMemo(() => sunFromHour(hour), [hour]);
  const elev = sun.y;
  const isNight = elev < 5;

  if (isNight) {
    return (
      <>
        <color attach="background" args={['#0b0e14']} />
        <ambientLight intensity={0.22} />
        <directionalLight position={[sun.x, Math.abs(sun.y) + 20, sun.z]} intensity={0.12} color="#a8b4c8" />
        <Stars radius={400} depth={80} count={5000} factor={3} saturation={0} fade speed={0.35} />
      </>
    );
  }

  const dusk = elev < 25;
  return (
    <>
      <Sky
        sunPosition={[sun.x, sun.y, sun.z]}
        turbidity={dusk ? 7 : 3.5}
        rayleigh={dusk ? 2.2 : 1.1}
        mieCoefficient={dusk ? 0.012 : 0.005}
        mieDirectionalG={0.8}
      />
      <ambientLight intensity={dusk ? 0.35 : 0.48} color={dusk ? '#ffd0b0' : '#ffffff'} />
      <directionalLight
        position={[sun.x, sun.y, sun.z]}
        intensity={dusk ? 0.85 : 1.2}
        color={dusk ? '#ff9a5c' : '#fff5e6'}
      />
      <hemisphereLight args={[dusk ? '#ffb070' : '#c8daf0', '#3a3a38', dusk ? 0.4 : 0.35]} />
    </>
  );
}

export default function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmState | null>(null);
  const [status, setStatus] = useState('Urban That \u00b7 import a map fragment to begin');
  const [hour, setHour] = useState(14);
  const abortRef = useRef<AbortController | null>(null);

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
      setStatus('Fetching OSM...');

      try {
        const data = await fetchOsmFragment(bbox, { signal: ac.signal });
        const ways = data.elements.filter((e) => e.type === 'way');
        const waysGeom = ways.filter((e) => e.geometry && e.geometry.length >= 2);
        console.info('[OSM]', {
          total: data.elements.length,
          ways: ways.length,
          waysWithGeometry: waysGeom.length,
        });

        const center = bboxCenter(bbox);
        const origin = createSceneOrigin(center.lat, center.lon);
        const built = buildOsmContextLayer(data, origin, bbox);

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
        setStatus(
          `OSM \u00b7 ${built.buildingCount} bld \u00b7 ${built.roadCount} roads \u00b7 ${built.waterCount} water \u00b7 ${built.greenCount} green \u00b7 ${built.treeCount} trees \u00b7 geom ${waysGeom.length}/${ways.length}`
        );
        setDialogOpen(false);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg =
          err instanceof OverpassError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Import failed';
        setError(msg);
        setStatus('Import failed');
      } finally {
        setLoading(false);
      }
    },
    [clearOsm]
  );

  const handleRefresh = useCallback(() => {
    if (osm?.bbox) handleImport(osm.bbox);
  }, [osm, handleImport]);

  const fitTarget = osm
    ? (() => {
        const box = new THREE.Box3().setFromObject(osm.group);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const radius = Math.max(size.x, size.z, 40) * 0.5;
        return { x: center.x, z: center.z, radius };
      })()
    : null;

  const hourLabel = `${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 >= 0.5 ? '30' : '00'}`;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [80, 60, 80], fov: 45, near: 0.1, far: 8000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#1c1c1e' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#1c1c1e');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Environment hour={hour} />
        <Suspense fallback={null}>{!osm && <GroundPlane size={2000} />}</Suspense>
        <group>{osm && <primitive object={osm.group} />}</group>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={3000}
          maxPolarAngle={Math.PI / 2.05}
        />
        <CameraFit target={fitTarget} />
      </Canvas>

      <div style={hud.bar}>
        <span style={hud.status}>{status}</span>
        <div style={hud.actions}>
          <div style={hud.timeWrap}>
            <span style={hud.timeLabel}>{hourLabel}</span>
            <input
              type="range"
              min={0}
              max={24}
              step={0.25}
              value={hour}
              onChange={(e) => setHour(parseFloat(e.target.value))}
              style={hud.slider}
              title="Time of day"
            />
          </div>
          {osm && (
            <button type="button" style={hud.btn} onClick={handleRefresh} disabled={loading}>
              Refresh OSM
            </button>
          )}
          <button
            type="button"
            style={hud.btnPrimary}
            onClick={() => {
              setError(null);
              setDialogOpen(true);
            }}
            disabled={loading}
          >
            Import map
          </button>
        </div>
      </div>

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
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    pointerEvents: 'none',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  status: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    letterSpacing: '-0.01em',
    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
    maxWidth: '45%',
  },
  actions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    pointerEvents: 'auto',
  },
  timeWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(58,58,60,0.9)',
    borderRadius: 8,
    padding: '4px 10px',
    backdropFilter: 'blur(8px)',
  },
  timeLabel: {
    color: '#f5f5f7',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 40,
  },
  slider: {
    width: 120,
    cursor: 'pointer',
    accentColor: '#0a84ff',
  },
  btn: {
    background: 'rgba(58,58,60,0.9)',
    color: '#f5f5f7',
    border: 'none',
    borderRadius: 8,
    padding: '7px 12px',
    fontSize: 13,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
  },
  btnPrimary: {
    background: 'rgba(10,132,255,0.95)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
