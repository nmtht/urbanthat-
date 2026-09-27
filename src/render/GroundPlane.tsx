/**
 * Flat ground plane (y = 0). All interaction raycasts target this plane.
 * Light mid-gray so the empty scene is never a black void.
 */
export function GroundPlane({ size = 4000 }: { size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      {/* MeshBasicMaterial: visible even before Atmosphere lights settle */}
      <meshBasicMaterial color="#6e6e72" />
    </mesh>
  );
}
