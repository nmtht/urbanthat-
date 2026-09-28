import type { CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ImportMapDialog } from './ui/ImportMapDialog';
import { Toolbar } from './ui/Toolbar';
import { SelectionBridge } from './tools/SelectionBridge';
import { ZoneBridge, ZoneMeshes } from './tools/ZoneBridge';
import { RoadBridge } from './tools/RoadBridge';
import { UserRoadsLayer } from './render/UserRoadsLayer';
import { UserBuildingsLayer } from './render/UserBuildingsLayer';
import { ZoneDrivewaysLayer } from './render/ZoneDrivewaysLayer';
import type { ZoneType } from './domain/zones';
import type { DrawMode, ZoneDrawMode } from './domain/roads';
import { ROAD_PROFILE_ORDER, ROAD_PROFILES, getRoadProfile } from './domain/roads';
import { StatusChip } from './ui/StatusChip';
import { EmptyState } from './ui/EmptyState';
import { ScenePanel } from './ui/ScenePanel';
import { InspectorPanel } from './ui/InspectorPanel';
import { HoverHud } from './ui/HoverHud';
import { NorthArrow } from './ui/NorthArrow';
import { Atmosphere } from './render/Atmosphere';
import { CameraFit, CameraYawReporter, PickBridge } from './AppHelpers';
import { useAppController } from './useAppController';
import {
  GenerateZoneCommand,
  ClearZoneBuildingsCommand,
  UpdateBuildingCommand,
  AddZoneCommand,
  AddRoadCommand,
} from './state/commandStack';
import { generateZoneContent } from './geometry/zoneGenerate';

export default function App() {
  const c = useAppController();
  const {
    dialogOpen, setDialogOpen, startedEmpty, setStartedEmpty, loading, error, osm, tool, setTool,
    zones, setZones, generatedBuildings, setGeneratedBuildings, zoneDriveways, setZoneDriveways,
    zoneType, setZoneType, userRoads, setUserRoads, roadProfile, setRoadProfile, roadOptions, setRoadOptions,
    roadDrawMode, setRoadDrawMode, zoneDrawMode, setZoneDrawMode, roadDraftPts, drawingActive,
    selected, setSelected, undoTick, cmdStack, hour, setHour, sceneOpen, setSceneOpen,
    quality, setQuality, fogAmount, setFogAmount, showGrid, setShowGrid, showNorth, setShowNorth,
    units, setUnits, hover, yawDeg, handleHover, handleImport, performDelete,
    fitKey, fitTarget, inspectorTarget, zoneGenStats, sceneStats, openImport,
    zonesRef, buildingsRef, drivewaysRef,
  } = c;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [80, 60, 80], fov: 45, near: 0.5, far: 80_000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#c5d6ea' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#c5d6ea');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Atmosphere hour={hour} fogAmount={fogAmount} />
        <group>{osm && <primitive object={osm.group} />}</group>
        {showGrid && (
          <gridHelper args={[2000, 40, '#3a3a3c', '#2c2c2e']} position={[0, 0.02, 0]} />
        )}
        <ZoneMeshes zones={zones} />
        <UserRoadsLayer roads={userRoads} quality={quality} hour={hour} />
        <ZoneDrivewaysLayer driveways={zoneDriveways} />
        <UserBuildingsLayer buildings={generatedBuildings} quality={quality} />
        <ZoneBridge
          enabled={tool === 'zone'}
          zoneType={zoneType}
          drawMode={zoneDrawMode}
          onCommit={(z) => cmdStack.current.push(new AddZoneCommand(z, setZones))}
          onDrawingActive={c.setDrawingActive}
        />
        <RoadBridge
          enabled={tool === 'road'}
          profileId={roadProfile}
          options={roadOptions}
          drawMode={roadDrawMode}
          existingRoads={userRoads}
          onCommit={(r) => cmdStack.current.push(new AddRoadCommand(r, setUserRoads))}
          onDraftChange={(pts) => c.setRoadDraftPts(pts ? pts.length : null)}
          onDrawingActive={c.setDrawingActive}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={12_000}
          maxPolarAngle={Math.PI / 2.02}
          enabled={!drawingActive}
        />
        <CameraFit target={fitTarget} fitKey={fitKey} />
        <CameraYawReporter onYaw={c.onYaw} />
        <PickBridge enabled={tool === 'select' || tool === 'delete'} onHover={handleHover} />
        <SelectionBridge
          tool={tool}
          enabled={tool === 'select' || tool === 'delete'}
          selected={selected}
          onSelect={(sel) => {
            setSelected(sel);
            if (sel) setSceneOpen(false);
          }}
          onDeleteClick={performDelete}
        />
      </Canvas>

      <Toolbar active={tool} onChange={setTool} onImport={openImport} />

      <div style={hud.top}>
        <StatusChip
          counts={
            osm
              ? {
                  buildingCount: osm.buildingCount,
                  roadCount: osm.roadCount + userRoads.length,
                  waterCount: osm.waterCount,
                  greenCount: osm.greenCount,
                  treeCount: osm.treeCount,
                }
              : userRoads.length || zones.length
                ? {
                    buildingCount: generatedBuildings.length,
                    roadCount: userRoads.length,
                    waterCount: 0,
                    greenCount: 0,
                    treeCount: 0,
                  }
                : null
          }
          loading={loading}
        />
        <div style={hud.topRight}>
          <button
            type="button"
            style={hud.btn}
            onClick={() => {
              setSelected(null);
              setSceneOpen((o) => !o);
            }}
          >
            Scene
          </button>
        </div>
      </div>

      {tool === 'zone' && (
        <div style={hud.toolPanel}>
          <div style={hud.zoneBar}>
            {(['residential', 'commercial', 'industrial', 'park', 'boundary'] as ZoneType[]).map(
              (zt) => (
                <button
                  key={zt}
                  type="button"
                  style={{ ...hud.zoneBtn, ...(zoneType === zt ? hud.zoneBtnOn : null) }}
                  onClick={() => setZoneType(zt)}
                >
                  {zt === 'boundary' ? 'Bnd' : zt.slice(0, 3)}
                </button>
              )
            )}
            <span style={hud.sep} />
            {([['rect', 'Rect'], ['polygon', 'Poly'], ['freehand', 'Free']] as [ZoneDrawMode, string][]).map(
              ([m, label]) => (
                <button
                  key={m}
                  type="button"
                  style={{ ...hud.zoneBtn, ...(zoneDrawMode === m ? hud.zoneBtnOn : null) }}
                  onClick={() => setZoneDrawMode(m)}
                >
                  {label}
                </button>
              )
            )}
            <span style={hud.zoneHint}>
              {zoneDrawMode === 'rect' ? 'drag rectangle' : zoneDrawMode === 'polygon' ? 'click · Enter' : 'hold-drag outline'}
            </span>
          </div>
        </div>
      )}

      {tool === 'road' && (
        <div style={hud.toolPanel}>
          <div style={hud.zoneBar}>
            {ROAD_PROFILE_ORDER.map((pid) => (
              <button
                key={pid}
                type="button"
                style={{ ...hud.zoneBtn, ...(roadProfile === pid ? hud.zoneBtnOn : null) }}
                onClick={() => {
                  setRoadProfile(pid);
                  setRoadOptions({});
                }}
                title={ROAD_PROFILES[pid].label}
              >
                {ROAD_PROFILES[pid].label.slice(0, 3)}
              </button>
            ))}
            <span style={hud.sep} />
            {([['straight', 'Straight'], ['curve', 'Curve'], ['freehand', 'Free']] as [DrawMode, string][]).map(
              ([m, label]) => (
                <button
                  key={m}
                  type="button"
                  style={{ ...hud.zoneBtn, ...(roadDrawMode === m ? hud.zoneBtnOn : null) }}
                  onClick={() => setRoadDrawMode(m)}
                >
                  {label}
                </button>
              )
            )}
            <span style={hud.zoneHint}>
              {roadDraftPts != null
                ? `${roadDraftPts} pts · Enter`
                : roadDrawMode === 'straight'
                  ? 'click · Enter'
                  : roadDrawMode === 'curve'
                    ? '3 clicks'
                    : 'hold-drag'}
            </span>
          </div>
          <div style={hud.zoneBar}>
            <label style={hud.optLabel}>
              Lanes
              <select
                style={hud.select}
                value={roadOptions.lanes ?? getRoadProfile(roadProfile).lanes}
                onChange={(e) => setRoadOptions((o) => ({ ...o, lanes: parseInt(e.target.value, 10) }))}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.parkingM ?? 0) > 0}
                onChange={(e) => setRoadOptions((o) => ({ ...o, parkingM: e.target.checked ? 2.2 : 0 }))}
              />
              Parking
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.greenBufferM ?? 0) > 0}
                onChange={(e) => setRoadOptions((o) => ({ ...o, greenBufferM: e.target.checked ? 1.5 : 0 }))}
              />
              Green
            </label>
            <label style={hud.optLabel}>
              <input
                type="checkbox"
                checked={(roadOptions.sidewalkM ?? getRoadProfile(roadProfile).sidewalkM) > 0}
                onChange={(e) =>
                  setRoadOptions((o) => ({
                    ...o,
                    sidewalkM: e.target.checked ? getRoadProfile(roadProfile).sidewalkM || 1.5 : 0,
                  }))
                }
              />
              Sidewalk
            </label>
          </div>
        </div>
      )}

      {!startedEmpty && !osm && !loading && (
        <EmptyState
          onImport={openImport}
          onStartEmpty={() => {
            setStartedEmpty(true);
            setDialogOpen(false);
          }}
        />
      )}

      <ScenePanel
        open={sceneOpen && !inspectorTarget}
        onClose={() => setSceneOpen(false)}
        hour={hour}
        onHour={setHour}
        quality={quality}
        onQuality={setQuality}
        fogAmount={fogAmount}
        onFogAmount={setFogAmount}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        showNorth={showNorth}
        onShowNorth={setShowNorth}
        units={units}
        onUnits={setUnits}
        stats={sceneStats}
      />

      <InspectorPanel
        target={inspectorTarget}
        units={units}
        onClose={() => setSelected(null)}
        onUpdateRoad={(id, patch) => {
          setUserRoads((prev) =>
            prev.map((r) => (r.id === id ? { ...r, ...patch, options: patch.options ?? r.options } : r))
          );
        }}
        onUpdateZone={(id, patch) => {
          setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
          if (patch.type !== undefined) setSelected(null);
        }}
        zoneBuildingCount={zoneGenStats.count}
        zoneActualFar={zoneGenStats.far}
        onGenerateZone={(zoneId) => {
          const zone = zonesRef.current.find((z) => z.id === zoneId);
          if (!zone) return;
          const content = generateZoneContent(zone);
          cmdStack.current.push(
            new GenerateZoneCommand(
              zoneId,
              content.buildings,
              () => buildingsRef.current,
              setGeneratedBuildings,
              content.buildings.length ? 'Generate zone content' : 'Clear buildings'
            )
          );
          cmdStack.current.push(
            new GenerateZoneCommand(
              zoneId,
              content.driveways,
              () => drivewaysRef.current,
              setZoneDriveways,
              'Generate driveways'
            )
          );
        }}
        onClearZoneBuildings={(zoneId) => {
          cmdStack.current.push(
            new ClearZoneBuildingsCommand(zoneId, () => buildingsRef.current, setGeneratedBuildings)
          );
          cmdStack.current.push(
            new ClearZoneBuildingsCommand(zoneId, () => drivewaysRef.current, setZoneDriveways)
          );
        }}
        onUpdateBuilding={(id, patch) => {
          cmdStack.current.push(
            new UpdateBuildingCommand(id, patch, () => buildingsRef.current, setGeneratedBuildings)
          );
        }}
      />

      <NorthArrow
        visible={showNorth && (!!osm || zones.length > 0 || userRoads.length > 0)}
        yawDeg={yawDeg}
      />
      <HoverHud info={hover.info} x={hover.x} y={hover.y} />

      {(osm || userRoads.length > 0 || zones.length > 0 || generatedBuildings.length > 0) && (
        <div
          key={undoTick}
          style={hud.undo}
          title={
            cmdStack.current.lastLabel
              ? `Undo: ${cmdStack.current.lastLabel} (Cmd+Z)`
              : 'Nothing to undo'
          }
        >
          {'\u2304'} {cmdStack.current.undoCount}
          {selected ? ` · ${selected.label}` : ''}
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
    position: 'absolute', top: 0, left: 0, right: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', pointerEvents: 'none', zIndex: 20,
  },
  topRight: { display: 'flex', gap: 8, pointerEvents: 'auto' },
  btn: {
    pointerEvents: 'auto', border: 'none', borderRadius: 10, padding: '8px 12px',
    background: 'rgba(44,44,46,0.75)', color: '#f5f5f7', fontSize: 13, fontWeight: 500,
    cursor: 'pointer', backdropFilter: 'blur(12px)',
  },
  toolPanel: {
    position: 'absolute', bottom: 88, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', flexDirection: 'column', gap: 6, zIndex: 22, alignItems: 'center',
    pointerEvents: 'auto',
  },
  zoneBar: {
    position: 'relative', display: 'flex', gap: 6, alignItems: 'center',
    padding: '6px 10px', borderRadius: 12, background: 'rgba(28,28,30,0.82)',
    backdropFilter: 'blur(16px)',
  },
  sep: { width: 1, height: 18, background: 'rgba(255,255,255,0.15)', margin: '0 4px' },
  optLabel: {
    display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.7)',
    fontSize: 11, fontFamily: '-apple-system, system-ui, sans-serif', cursor: 'pointer',
  },
  select: {
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4,
    color: '#fff', fontSize: 11, padding: '2px 4px',
  },
  zoneBtn: {
    border: 'none', borderRadius: 8, padding: '6px 10px', background: 'transparent',
    color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: '-apple-system, system-ui, sans-serif',
    cursor: 'pointer', textTransform: 'capitalize',
  },
  zoneBtnOn: { background: 'rgba(255,255,255,0.12)', color: '#fff' },
  zoneHint: {
    color: 'rgba(255,255,255,0.35)', fontSize: 11, marginLeft: 4,
    fontFamily: '-apple-system, system-ui, sans-serif',
  },
  undo: {
    position: 'absolute', bottom: 16, left: 16, padding: '6px 10px', borderRadius: 8,
    background: 'rgba(44,44,46,0.6)', color: 'rgba(255,255,255,0.45)', fontSize: 12,
    fontFamily: '-apple-system, system-ui, sans-serif', pointerEvents: 'none', zIndex: 18,
  },
};
