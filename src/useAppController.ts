import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type ToolId } from './ui/Toolbar';
import { type SelectedOsm } from './tools/SelectionBridge';
import type { ZoneRect, ZoneType, GeneratedBuilding, ZoneDriveway, ZoneCourtyard } from './domain/zones';
import type { RoadCenterline, RoadProfileId, RoadOptions, DrawMode, ZoneDrawMode } from './domain/roads';
import { ROAD_PROFILE_ORDER } from './domain/roads';
import {
  CommandStack,
  DeleteOsmCommand,
  DeleteRoadCommand,
  GenerateZoneCommand,
  DeleteBuildingCommand,
} from './state/commandStack';
import { generateZoneContent, generateBuildingsForZone, actualFar } from './geometry/zoneGenerate';
import { type ModelQuality } from './ui/ScenePanel';
import { type InspectorTarget } from './ui/InspectorPanel';
import { computeSceneStats } from './domain/stats';
import { type HoverInfo } from './ui/HoverHud';
import {
  createSceneOrigin,
  bboxCenter,
  type BBox,
} from './domain/SceneOrigin';
import { fetchOsmFragment, OverpassError } from './osm/overpassClient';
import {
  buildOsmContextLayer,
  disposeOsmContextLayer,
} from './osm/osmContextLayer';
import { setFacadeNightFactor, clearFacadeCache, applyQualityToOsmGroup } from './render/buildingFacades';
import { nightFactorFromHour } from './render/Atmosphere';
import { type OsmState } from './AppHelpers';

export function useAppController() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startedEmpty, setStartedEmpty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmState | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [zones, setZones] = useState<ZoneRect[]>([]);
  const [generatedBuildings, setGeneratedBuildings] = useState<GeneratedBuilding[]>([]);
  const [zoneDriveways, setZoneDriveways] = useState<ZoneDriveway[]>([]);
  const [zoneCourtyards, setZoneCourtyards] = useState<ZoneCourtyard[]>([]);
  const [zoneType, setZoneType] = useState<ZoneType>('residential');
  const [userRoads, setUserRoads] = useState<RoadCenterline[]>([]);
  const [roadProfile, setRoadProfile] = useState<RoadProfileId>('residential');
  const [roadOptions, setRoadOptions] = useState<RoadOptions>({});
  const [roadDrawMode, setRoadDrawMode] = useState<DrawMode>('straight');
  const [zoneDrawMode, setZoneDrawMode] = useState<ZoneDrawMode>('rect');
  const [roadDraftPts, setRoadDraftPts] = useState<number | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const [selected, setSelected] = useState<SelectedOsm | null>(null);
  const [undoTick, setUndoTick] = useState(0);
  const cmdStack = useRef(new CommandStack());
  useEffect(() => cmdStack.current.subscribe(() => setUndoTick((n) => n + 1)), []);
  const [hour, setHour] = useState(14);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [quality, setQuality] = useState<ModelQuality>('med');
  const [fogAmount, setFogAmount] = useState(0.35);
  const [showGrid, setShowGrid] = useState(false);
  const [showNorth, setShowNorth] = useState(true);
  const [units, setUnits] = useState<'m' | 'ft'>('m');
  const [hover, setHover] = useState<{ info: HoverInfo | null; x: number; y: number }>({
    info: null,
    x: 0,
    y: 0,
  });
  const [yawDeg, setYawDeg] = useState(0);
  const onYaw = useCallback((d: number) => setYawDeg(d), []);
  const handleHover = useCallback((info: HoverInfo | null, x: number, y: number) => {
    setHover((prev) => {
      if (!info && !prev.info) return prev;
      if (
        info &&
        prev.info &&
        info.label === prev.info.label &&
        info.kind === prev.info.kind &&
        Math.abs(x - prev.x) < 4 &&
        Math.abs(y - prev.y) < 4
      ) {
        return prev;
      }
      return { info, x, y };
    });
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const lastBbox = useRef<BBox | null>(null);

  useEffect(() => {
    setFacadeNightFactor(hour);
    const night = nightFactorFromHour(hour);
    if (osm) {
      osm.group.traverse((obj) => {
        if (obj.userData?.kind === 'street-lamp-light' && obj instanceof THREE.PointLight) {
          const base = (obj.userData.baseIntensity as number) ?? 1.2;
          obj.intensity = base * night;
        }
        if (obj.userData?.kind === 'street-lamp-head' && obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat?.emissiveIntensity != null) mat.emissiveIntensity = 0.15 + night * 0.85;
        }
      });
    }
  }, [hour, osm]);

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
      lastBbox.current = bbox;

      try {
        const data = await fetchOsmFragment(bbox, { signal: ac.signal });
        const center = bboxCenter(bbox);
        const origin = createSceneOrigin(center.lat, center.lon);
        const built = buildOsmContextLayer(data, origin, bbox, { quality });

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
        setDialogOpen(false);
        setStartedEmpty(true);
        setSelected(null);
        setZones([]);
        setUserRoads([]);
        setGeneratedBuildings([]);
        setZoneDriveways([]);
        setZoneCourtyards([]);
        cmdStack.current.clear();
        setFacadeNightFactor(hour);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg =
          err instanceof OverpassError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Import failed';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [clearOsm, quality, hour]
  );

  const handleRefresh = useCallback(() => {
    if (lastBbox.current) handleImport(lastBbox.current);
  }, [handleImport]);

  const userRoadsRef = useRef(userRoads);
  userRoadsRef.current = userRoads;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const buildingsRef = useRef(generatedBuildings);
  buildingsRef.current = generatedBuildings;
  const drivewaysRef = useRef(zoneDriveways);
  drivewaysRef.current = zoneDriveways;
  const courtyardsRef = useRef(zoneCourtyards);
  courtyardsRef.current = zoneCourtyards;

  const performDelete = useCallback((sel: SelectedOsm) => {
    if (sel.kind === 'user-road') {
      const roadId =
        sel.roadId ??
        (sel.object.userData?.roadId as string | undefined) ??
        (sel.object.parent?.userData?.roadId as string | undefined);
      if (roadId) {
        const road = userRoadsRef.current.find((r) => r.id === roadId);
        if (road) cmdStack.current.push(new DeleteRoadCommand(road, setUserRoads));
      }
      setSelected(null);
      return;
    }
    if (sel.kind === 'user-building') {
      const bid =
        sel.buildingId ??
        (sel.object.userData?.buildingId as string | undefined) ??
        (sel.object.parent?.userData?.buildingId as string | undefined);
      if (bid) {
        const b = buildingsRef.current.find((x) => x.id === bid);
        if (b) cmdStack.current.push(new DeleteBuildingCommand(b, setGeneratedBuildings));
      }
      setSelected(null);
      return;
    }
    if (sel.kind === 'zone') {
      const zoneId = sel.zoneId ?? (sel.object.userData?.zoneId as string | undefined);
      if (zoneId) {
        setZones((prev) => prev.filter((z) => z.id !== zoneId));
        setGeneratedBuildings((prev) => prev.filter((b) => b.zoneId !== zoneId));
        setZoneDriveways((prev) => prev.filter((d) => d.zoneId !== zoneId));
        setZoneCourtyards((prev) => prev.filter((c) => c.zoneId !== zoneId));
      }
      setSelected(null);
      return;
    }
    const targets = sel.objects?.length ? sel.objects : [sel.object];
    cmdStack.current.push(
      new DeleteOsmCommand(
        targets,
        targets.length > 1 ? `${sel.kind} x${targets.length}` : sel.kind
      )
    );
    setSelected(null);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (ev.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (ev.key === 'g' || ev.key === 'G') {
        if (selected?.kind === 'zone') {
          const zid = selected.zoneId ?? (selected.object.userData?.zoneId as string | undefined);
          const zone = zonesRef.current.find((z) => z.id === zid);
          if (zone && zone.type !== 'boundary' && zone.type !== 'park') {
            const content = generateZoneContent(zone);
            cmdStack.current.push(
              new GenerateZoneCommand(
                zone.id,
                content.buildings,
                () => buildingsRef.current,
                setGeneratedBuildings,
                content.buildings.length ? 'Generate zone content' : 'Clear buildings'
              )
            );
            cmdStack.current.push(
              new GenerateZoneCommand(
                zone.id,
                content.driveways,
                () => drivewaysRef.current,
                setZoneDriveways,
                'Generate driveways'
              )
            );
            cmdStack.current.push(
              new GenerateZoneCommand(
                zone.id,
                content.courtyards,
                () => courtyardsRef.current,
                setZoneCourtyards,
                'Generate courtyards'
              )
            );
          }
        }
        return;
      }
      if (ev.key === 'v' || ev.key === 'V') {
        setTool('select');
        return;
      }
      if (ev.key === 'x' || ev.key === 'X') {
        setTool('delete');
        return;
      }
      if (ev.key === 'r' || ev.key === 'R') {
        if (!(ev.metaKey || ev.ctrlKey)) {
          setTool('road');
          return;
        }
      }
      if ((ev.key === 'z' || ev.key === 'Z') && !(ev.metaKey || ev.ctrlKey)) {
        setTool('zone');
        return;
      }
      if (ev.key === '1' || ev.key === '2' || ev.key === '3' || ev.key === '4' || ev.key === '5') {
        const n = parseInt(ev.key, 10);
        if (tool === 'road') {
          const pid = ROAD_PROFILE_ORDER[n - 1];
          if (pid) setRoadProfile(pid);
          return;
        }
        const zmap: Record<string, ZoneType> = {
          '1': 'residential',
          '2': 'commercial',
          '3': 'industrial',
          '4': 'park',
          '5': 'boundary',
        };
        if (zmap[ev.key]) {
          setZoneType(zmap[ev.key]);
          setTool('zone');
        }
        return;
      }
      if ((ev.key === 'z' || ev.key === 'Z') && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        if (ev.shiftKey) cmdStack.current.redo();
        else cmdStack.current.undo();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selected) {
          ev.preventDefault();
          performDelete(selected);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, performDelete, tool]);

  const qualityRef = useRef(quality);
  useEffect(() => {
    if (qualityRef.current === quality) return;
    qualityRef.current = quality;
    clearFacadeCache();
    if (osm) {
      applyQualityToOsmGroup(osm.group, quality);
    }
    if (lastBbox.current) {
      handleImport(lastBbox.current);
    }
  }, [quality, handleImport, osm]);

  const fitKey = osm ? `${osm.bbox.south},${osm.bbox.west},${osm.buildingCount}` : null;
  const fitTarget = useMemo(() => {
    if (!osm) return null;
    const box = new THREE.Box3().setFromObject(osm.group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.z, 40) * 0.5;
    return { x: center.x, z: center.z, radius };
  }, [osm]);

  const inspectorTarget: InspectorTarget | null = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'user-road') {
      const id = selected.roadId ?? (selected.object.userData?.roadId as string | undefined);
      const road = userRoads.find((r) => r.id === id);
      if (road) return { kind: 'user-road', road };
    }
    if (selected.kind === 'zone') {
      const id = selected.zoneId ?? (selected.object.userData?.zoneId as string | undefined);
      const zone = zones.find((z) => z.id === id);
      if (zone) return { kind: 'zone', zone };
    }
    if (selected.kind === 'user-building') {
      const id =
        selected.buildingId ??
        (selected.object.userData?.buildingId as string | undefined);
      const building = generatedBuildings.find((b) => b.id === id);
      if (building) return { kind: 'user-building', building };
    }
    if (selected.kind === 'building' || selected.kind === 'road') {
      const tags = (selected.object.userData?.osmTags ?? {}) as Record<string, string>;
      return { kind: 'osm', label: selected.label, osmKind: selected.kind, tags };
    }
    return null;
  }, [selected, userRoads, zones, generatedBuildings]);

  const zoneGenStats = useMemo(() => {
    if (inspectorTarget?.kind !== 'zone') return { count: 0, far: 0 };
    const zid = inspectorTarget.zone.id;
    const list = generatedBuildings.filter((b) => b.zoneId === zid);
    return { count: list.length, far: actualFar(list, inspectorTarget.zone) };
  }, [inspectorTarget, generatedBuildings]);

  const sceneStats = useMemo(() => computeSceneStats(userRoads, zones), [userRoads, zones]);

  const openImport = () => {
    setError(null);
    setDialogOpen(true);
  };

  return {
    dialogOpen, setDialogOpen, startedEmpty, setStartedEmpty, loading, error, osm, tool, setTool,
    zones, setZones, generatedBuildings, setGeneratedBuildings,
    zoneDriveways, setZoneDriveways, zoneCourtyards, setZoneCourtyards,
    zoneType, setZoneType,
    userRoads, setUserRoads, roadProfile, setRoadProfile, roadOptions, setRoadOptions,
    roadDrawMode, setRoadDrawMode, zoneDrawMode, setZoneDrawMode, roadDraftPts, setRoadDraftPts,
    drawingActive, setDrawingActive, selected, setSelected, undoTick, cmdStack,
    hour, setHour, sceneOpen, setSceneOpen, quality, setQuality, fogAmount, setFogAmount,
    showGrid, setShowGrid, showNorth, setShowNorth, units, setUnits, hover, setHover,
    yawDeg, onYaw, handleHover, handleImport, handleRefresh, performDelete,
    fitKey, fitTarget, inspectorTarget, zoneGenStats, sceneStats, openImport,
    zonesRef, buildingsRef, drivewaysRef, courtyardsRef, userRoadsRef,
  };
}
