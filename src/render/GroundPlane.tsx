/**
 * Flat ground plane (y = 0). All interaction raycasts target this plane.
 * Terrain elevation is explicitly out of MVP scope.
 */
export function GroundPlane({ size = 400 }: { size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#2a2a2c" roughness={0.95} metalness={0} />
    </mesh>
  );
}
