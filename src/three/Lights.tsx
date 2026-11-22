export function Lights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#3a3d44', 0.9]} />
      <directionalLight
        castShadow
        position={[3, 6, 4]}
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.5, 20]} />
      </directionalLight>
      <directionalLight position={[-4, 3, -2]} intensity={0.35} />
    </>
  );
}
