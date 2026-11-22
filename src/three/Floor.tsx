export function Floor() {
  return (
    <>
      <gridHelper args={[20, 40, '#3a3e45', '#262a2f']} position={[0, 0.001, 0]} userData={{ noSnap: true }} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
    </>
  );
}
