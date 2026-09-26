import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Sky, Stars } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
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

type DayMode = 'day' | 'dusk' | 'night';

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

function Environment({ mode }: { mode: DayMode }) {
  if (mode === 'night') {
    return (
      <>
        <color attach="background" args={['#0b0e14']} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[40, 80, 20]} intensity={0.15} color="#a8b4c8" />
        <Stars radius={400} depth={80} count={4000} factor={3} saturation={0} fade speed={0.4} />
      </>
    );
  }
  if (mode === 'dusk') {
    return (
      <>
        <Sky sunPosition={[-20, 2, -40]} turbidity={8} rayleigh={2.5} mieCoefficient={0.01} mieDirectionalG={0.8} />
        <ambientLight intensity={0.35} color="#ffd0b0" />
        <directionalLight position={[-40, 15, -30]} intensity={0.9} color="#ff9a5c" />
        <hemisphereLight args={['#ffb070', '#2a2030', 0.4]} />
      </>
    );
  }
  return (
    <>
      <Sky sunPosition={[80, 40, 40]} turbidity={4} rayleigh={1.2} mieCoefficient={0.005} mieDirectionalG={0.8} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[120, 180, 80]} intensity={1.15} color="#fff5e6" />
      <hemisphereLight args={['#c8daf0', '#3a3a38', 0.35]} />
    </>
  );
}

export default function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmState | null>(null);
  const [status, setStatus] = useState('Urban That \u00b7 import a map fragment to begin');
  const [dayMode, setDayMode] = useState<DayMode>('day');
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
          `OSM \u00b7 ${built.buildingCount} bld \u00b7 ${built.roadCount} roads \u00b7 ${built.waterCount} water \u00b7 ${built.greenCount} green \u00b7 ${built.treeCount} trees`
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

  const cycleDay = () => {
    setDayMode((m) => (m === 'day' ? 'dusk' : m === 'dusk' ? 'night' : 'day'));
  };

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
        <Environment mode={dayMode} />
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
          <button type="button" style={hud.btn} onClick={cycleDay} title="Day / Dusk / Night">
            {dayMode === 'day' ? 'Day' : dayMode === 'dusk' ? 'Dusk' : 'Night'}
          </button>
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
  },
  actions: {
    display: 'flex',
    gap: 8,
    pointerEvents: 'auto',
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
