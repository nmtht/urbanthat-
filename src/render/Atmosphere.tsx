import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';

export function dayFactorFromHour(hour: number): number {
  if (hour >= 5.5 && hour <= 20.5) {
    const t = (hour - 5.5) / 15;
    return Math.sin(t * Math.PI);
  }
  if (hour < 5.5) {
    const d = 5.5 - hour;
    return Math.max(0, 1 - d / 2) * 0.08;
  }
  const d = hour - 20.5;
  return Math.max(0, 1 - d / 2) * 0.08;
}

export function nightFactorFromHour(hour: number): number {
  if (hour < 5.5 || hour > 20.5) return 1;
  if (hour < 7) return 1 - (hour - 5.5) / 1.5;
  if (hour > 19) return (hour - 19) / 1.5;
  return 0;
}

function sunFromHour(hour: number): THREE.Vector3 {
  const t = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.sin(t);
  const azimuth = ((hour - 12) / 12) * Math.PI;
  const x = Math.cos(azimuth);
  const z = Math.sin(azimuth) * 0.65;
  return new THREE.Vector3(x, elevation, z).normalize().multiplyScalar(100);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpColor(a: number, b: number, t: number): number {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
}

interface Props {
  hour: number;
  /** 0 = clear, 1 = heavy haze. */
  fogAmount?: number;
}

export function Atmosphere({ hour, fogAmount = 0.35 }: Props) {
  const { scene, camera, gl } = useThree();
  const sun = useMemo(() => sunFromHour(hour), [hour]);
  const day = dayFactorFromHour(hour);
  const night = nightFactorFromHour(hour);
  const elevN = sun.clone().normalize().y;

  const duskW = Math.max(0, 1 - Math.abs(elevN - 0.15) / 0.35);
  const nightW = Math.max(0, -elevN);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.near = 0.5;
    cam.far = 80_000;
    cam.updateProjectionMatrix();

    const nightCol = 0x070a10;
    const duskCol = 0xc4a888;
    const dayCol = 0xc5d6ea;
    let horizon: number;
    if (elevN > 0.25) horizon = dayCol;
    else if (elevN > 0) horizon = lerpColor(duskCol, dayCol, elevN / 0.25);
    else if (elevN > -0.15) horizon = lerpColor(nightCol, duskCol, 1 + elevN / 0.15);
    else horizon = nightCol;

    // Linear fog — clearly responds to slider (0 clear … 1 heavy).
    const t = Math.max(0, Math.min(1, fogAmount));
    const near = lerp(800, 40, t);
    const far = lerp(4000, 220, t);
    const nearAdj = near * (1 - nightW * 0.25 - duskW * 0.1);
    const farAdj = far * (1 - nightW * 0.2);

    if (elevN < -0.05) {
      scene.background = new THREE.Color(horizon);
    } else {
      scene.background = null;
    }
    scene.fog = new THREE.Fog(horizon, nearAdj, farAdj);
    gl.setClearColor(horizon);

    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [elevN, fogAmount, scene, camera, gl]);

  const ambI = lerp(0.12, 0.55, day);
  const dirI = lerp(0.08, 1.3, Math.max(0, elevN));
  const hemiI = lerp(0.15, 0.45, day);

  const ambColor = elevN < 0.2 ? '#ffd0b0' : '#ffffff';
  const dirColor = elevN < 0.15 ? '#ff9a5c' : elevN < 0.35 ? '#ffd0a0' : '#fff5e6';
  const skyHemi = elevN < 0.2 ? '#ffb070' : '#d0e4f8';

  const skySunY = Math.max(elevN, 0.02);
  const skySun: [number, number, number] = [sun.x, skySunY * 100, sun.z];

  const turbidity = lerp(2.5, 10, duskW);
  const rayleigh = lerp(0.6, 2.6, duskW + nightW * 0.3);
  const mie = lerp(0.003, 0.014, duskW);

  return (
    <>
      {elevN > -0.12 && (
        <Sky
          distance={450_000}
          sunPosition={skySun}
          turbidity={turbidity}
          rayleigh={rayleigh}
          mieCoefficient={mie}
          mieDirectionalG={0.85}
        />
      )}
      <ambientLight intensity={ambI} color={ambColor} />
      <directionalLight
        position={[sun.x, Math.max(Math.abs(sun.y), 20), sun.z]}
        intensity={dirI}
        color={dirColor}
      />
      <hemisphereLight args={[skyHemi, '#3c3c38', hemiI]} />
      {night > 0.15 && (
        <Stars
          radius={600}
          depth={120}
          count={Math.floor(2000 + night * 5000)}
          factor={3.5}
          saturation={0}
          fade
          speed={0.3}
        />
      )}
    </>
  );
}
