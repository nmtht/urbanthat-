import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { ImportMapDialog } from './ui/ImportMapDialog';
import { Toolbar, type ToolId } from './ui/Toolbar';
import { SelectionBridge, type SelectedOsm } from './tools/SelectionBridge';
import { ZoneBridge, ZoneMeshes } from './tools/ZoneBridge';
import { RoadBridge } from './tools/RoadBridge';
import { UserRoadsLayer } from './render/UserRoadsLayer';
import type { ZoneRect, ZoneType, GeneratedBuilding } from './domain/zones';
import type { RoadCenterline, RoadProfileId, RoadOptions, DrawMode, ZoneDrawMode } from './domain/roads';
import { ROAD_PROFILE_ORDER, ROAD_PROFILES, getRoadProfile } from './domain/roads';
import {
  CommandStack,
  DeleteOsmCommand,
  AddZoneCommand,
  AddRoadCommand,
  DeleteRoadCommand,
  GenerateZoneCommand,
  ClearZoneBuildingsCommand,
  DeleteBuildingCommand,
  UpdateBuildingCommand,
} from './state/commandStack';
import { UserBuildingsLayer } from './render/UserBuildingsLayer';
import { generateBuildingsForZone, actualFar } from './geometry/zoneGenerate';
import { StatusChip } from './ui/StatusChip';
import { EmptyState } from './ui/EmptyState';
import { ScenePanel, type ModelQuality } from './ui/ScenePanel';
import { InspectorPanel, type InspectorTarget } from './ui/InspectorPanel';
import { computeSceneStats } from './domain/stats';
import { HoverHud, type HoverInfo } from './ui/HoverHud';
import { NorthArrow } from './ui/NorthArrow';
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
import { setFacadeNightFactor, clearFacadeCache, applyQualityToOsmGroup } from './render/buildingFacades';
import { Atmosphere, nightFactorFromHour } from './render/Atmosphere';

// NOTE: Full App.tsx body continues in next commit if truncated — see artifacts/App.tsx
export default function App() {
  return null;
}
