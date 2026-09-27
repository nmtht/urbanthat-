/**
 * Flat ground plane (y = 0). All interaction raycasts target this plane.
 * Terrain elevation is explicitly out of MVP scope.
 * Use MeshStandardMaterial with a mid-gray so the empty scene reads as ground, not a void.
 */
export function GroundPlane({ size = 4000 }: { size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#5c5c60" roughness={0.95} metalness={0} />
    </mesh>
  );
}
