import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense } from 'react';
import { GroundPlane } from './render/GroundPlane';

/**
 * Root UI shell.
 * Three.js canvas fills the window; React panels will overlay later.
 */
export default function App() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [80, 60, 80], fov: 45, near: 0.1, far: 5000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#1c1c1e' }}
      >
        <color attach="background" args={['#1c1c1e']} />
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[120, 180, 80]}
          intensity={1.1}
          castShadow={false}
        />
        <Suspense fallback={null}>
          <GroundPlane size={400} />
        </Suspense>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={800}
          maxPolarAngle={Math.PI / 2.05}
        />
        <gridHelper args={[400, 40, '#2c2c2e', '#252528']} position={[0, 0.01, 0]} />
      </Canvas>

      {/* Temporary HUD — will become proper React panels */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          fontSize: 13,
          letterSpacing: '-0.01em',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        Urban That · skeleton
      </div>
    </div>
  );
}
