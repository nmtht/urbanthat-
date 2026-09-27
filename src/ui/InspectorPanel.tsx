import type { CSSProperties } from 'react';
import type { RoadCenterline, RoadProfileId, RoadOptions } from '../domain/roads';
import {
  ROAD_PROFILE_ORDER,
  ROAD_PROFILES,
  getRoadProfile,
  resolveRoadGeometry,
} from '../domain/roads';
import type { ZoneRect, ZoneType, ZoneBuildForm } from '../domain/zones';
import {
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_BUILD_FORMS,
  zoneAreaM2,
  zoneDisplayName,
} from '../domain/zones';
import { roadLengthM, roadAreaM2, formatM, formatArea } from '../domain/stats';

export type InspectorTarget =
  | { kind: 'user-road'; road: RoadCenterline }
  | { kind: 'zone'; zone: ZoneRect }
  | { kind: 'user-building'; building: import('../domain/zones').GeneratedBuilding }
  | { kind: 'osm'; label: string; osmKind: string; tags: Record<string, string> };

interface Props {
  target: InspectorTarget | null;
  units: 'm' | 'ft';
  onClose: () => void;
  onUpdateRoad?: (id: string, patch: Partial<RoadCenterline>) => void;
  onUpdateZone?: (id: string, patch: Partial<ZoneRect>) => void;
  onGenerateZone?: (zoneId: string) => void;
  onClearZoneBuildings?: (zoneId: string) => void;
  onUpdateBuilding?: (id: string, patch: Partial<import('../domain/zones').GeneratedBuilding>) => void;
  zoneBuildingCount?: number;
  zoneActualFar?: number;
}

export function InspectorPanel({
  target,
  units,
  onClose,
  onUpdateRoad,
  onUpdateZone,
  onGenerateZone,
  onClearZoneBuildings,
  onUpdateBuilding,
  zoneBuildingCount,
  zoneActualFar,
}: Props) {
  if (!target) return null;

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <span style={s.title}>
          {target.kind === 'user-road'
            ? 'Road'
            : target.kind === 'zone'
              ? target.zone.type === 'boundary'
                ? 'Boundary'
                : 'Zone'
              : target.kind === 'user-building'
                ? 'Building'
                : 'Object'}
        </span>
        <button type="button" style={s.close} onClick={onClose} aria-label="Close">
          {'\u2715'}
        </button>
      </div>

      {target.kind === 'user-road' && (
        <RoadInspector
          road={target.road}
          units={units}
          onChange={(patch) => onUpdateRoad?.(target.road.id, patch)}
        />
      )}
      {target.kind === 'zone' && (
        <ZoneInspector
          zone={target.zone}
          units={units}
          onChange={(patch) => onUpdateZone?.(target.zone.id, patch)}
          onGenerate={() => onGenerateZone?.(target.zone.id)}
          onClear={() => onClearZoneBuildings?.(target.zone.id)}
          buildingCount={zoneBuildingCount}
          actualFar={zoneActualFar}
        />
      )}
      {target.kind === 'user-building' && (
        <BuildingInspector
          building={target.building}
          units={units}
          onChange={(patch) => onUpdateBuilding?.(target.building.id, patch)}
        />
      )}
      {target.kind === 'osm' && (
        <OsmInspector label={target.label} osmKind={target.osmKind} tags={target.tags} />
      )}
    </div>
  );
}

function RoadInspector({
  road,
  units,
  onChange,
}: {
  road: RoadCenterline;
  units: 'm' | 'ft';
  onChange: (patch: Partial<RoadCenterline>) => void;
}) {
  const g = resolveRoadGeometry(road.profileId, road.options);
  const len = roadLengthM(road);
  const area = roadAreaM2(road);
  const opts: RoadOptions = road.options ?? {};

  const setOpt = (key: keyof RoadOptions, value: number) => {
    onChange({ options: { ...opts, [key]: value } });
  };

  return (
    <>
      <div style={s.name}>{ROAD_PROFILES[road.profileId]?.label ?? 'Road'}</div>
      <div style={s.section}>Statistics</div>
      <Row label="Length" value={formatM(len, units)} />
      <Row label="Carriage width" value={formatM(g.carriageWidthM, units)} />
      <Row label="Asphalt area" value={formatArea(area, units)} />
      <Row label="Vertices" value={String(road.points.length)} />

      <div style={s.section}>Type</div>
      <div style={s.seg}>
        {ROAD_PROFILE_ORDER.map((pid) => (
          <button
            key={pid}
            type="button"
            style={{ ...s.segBtn, ...(road.profileId === pid ? s.segOn : null) }}
            onClick={() => onChange({ profileId: pid as RoadProfileId, options: {} })}
            title={ROAD_PROFILES[pid].label}
          >
            {ROAD_PROFILES[pid].label.slice(0, 3)}
          </button>
        ))}
      </div>

      <div style={s.section}>Attributes</div>
      <label style={s.field}>
        <span style={s.fieldLabel}>Lanes</span>
        <select
          style={s.select}
          value={opts.lanes ?? g.lanes}
          onChange={(e) => setOpt('lanes', parseInt(e.target.value, 10))}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={(opts.parkingM ?? 0) > 0}
          onChange={(e) => setOpt('parkingM', e.target.checked ? 2.2 : 0)}
        />
        Parking lane
      </label>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={(opts.greenBufferM ?? 0) > 0}
          onChange={(e) => setOpt('greenBufferM', e.target.checked ? 1.5 : 0)}
        />
        Green buffer
      </label>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={(opts.sidewalkM ?? getRoadProfile(road.profileId).sidewalkM) > 0}
          onChange={(e) =>
            setOpt(
              'sidewalkM',
              e.target.checked ? getRoadProfile(road.profileId).sidewalkM || 1.5 : 0
            )
          }
        />
        Sidewalk
      </label>
    </>
  );
}

function ZoneInspector({
  zone,
  units,
  onChange,
  onGenerate,
  onClear,
  buildingCount,
  actualFar,
}: {
  zone: ZoneRect;
  units: 'm' | 'ft';
  onChange: (patch: Partial<ZoneRect>) => void;
  onGenerate?: () => void;
  onClear?: () => void;
  buildingCount?: number;
  actualFar?: number;
}) {
  const area = zoneAreaM2(zone);
  const isBoundary = zone.type === 'boundary';
  const canGenerate = !isBoundary && zone.type !== 'park';

  return (
    <>
      <label style={s.field}>
        <span style={s.fieldLabel}>Name</span>
        <input
          style={s.input}
          value={zone.name ?? ''}
          placeholder={zoneDisplayName(zone)}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <div style={s.section}>Statistics</div>
      <Row label="Area" value={formatArea(area, units)} />
      {zone.polygon && <Row label="Vertices" value={String(zone.polygon.length)} />}
      {!zone.polygon && (
        <Row
          label="Size"
          value={`${formatM(zone.maxX - zone.minX, units)} × ${formatM(zone.maxY - zone.minY, units)}`}
        />
      )}

      <div style={s.section}>Function</div>
      <div style={s.segWrap}>
        {(Object.keys(ZONE_LABELS) as ZoneType[]).map((t) => (
          <button
            key={t}
            type="button"
            style={{
              ...s.segBtn,
              flex: '1 1 40%',
              ...(zone.type === t ? s.segOn : null),
              borderLeft: `3px solid ${ZONE_COLORS[t]}`,
            }}
            onClick={() => onChange({ type: t })}
          >
            {ZONE_LABELS[t]}
          </button>
        ))}
      </div>

      {!isBoundary && (
        <>
          <div style={s.section}>Build form</div>
          <div style={s.segWrap}>
            {ZONE_BUILD_FORMS.map((f) => (
              <button
                key={f.id}
                type="button"
                style={{
                  ...s.segBtn,
                  flex: '1 1 40%',
                  ...((zone.buildForm ?? 'block') === f.id ? s.segOn : null),
                }}
                onClick={() => onChange({ buildForm: f.id as ZoneBuildForm })}
              >
                {f.label.split(' ')[0]}
              </button>
            ))}
          </div>

          <div style={s.section}>Zoning metrics</div>
          <label style={s.field}>
            <span style={s.fieldLabel}>FAR</span>
            <input
              style={s.input}
              type="number"
              min={0}
              max={20}
              step={0.1}
              value={zone.far ?? ''}
              placeholder="—"
              onChange={(e) =>
                onChange({
                  far: e.target.value === '' ? undefined : parseFloat(e.target.value),
                })
              }
            />
          </label>
          <label style={s.field}>
            <span style={s.fieldLabel}>Max floors</span>
            <input
              style={s.input}
              type="number"
              min={0}
              max={100}
              step={1}
              value={zone.maxFloors ?? ''}
              placeholder="—"
              onChange={(e) =>
                onChange({
                  maxFloors:
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
            />
          </label>
          <label style={s.field}>
            <span style={s.fieldLabel}>Coverage</span>
            <input
              style={s.input}
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={zone.coverage ?? ''}
              placeholder="0–1"
              onChange={(e) =>
                onChange({
                  coverage: e.target.value === '' ? undefined : parseFloat(e.target.value),
                })
              }
            />
          </label>
          <div style={s.hint}>FAR / floors / coverage — zoning sprint</div>
        </>
      )}

      {canGenerate && (
        <>
          <div style={s.section}>Generation</div>
          {(buildingCount ?? 0) > 0 && (
            <Row
              label="Buildings"
              value={`${buildingCount} · FAR ${(actualFar ?? 0).toFixed(2)} / ${(zone.far ?? '—')}`}
            />
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" style={s.actionBtn} onClick={onGenerate}>
              {(buildingCount ?? 0) > 0 ? 'Regenerate' : 'Generate'}
            </button>
            {(buildingCount ?? 0) > 0 && (
              <button type="button" style={s.actionBtnGhost} onClick={onClear}>
                Clear
              </button>
            )}
          </div>
          <div style={s.hint}>Hotkey G · seed in zone controls determinism</div>
          <label style={s.field}>
            <span style={s.fieldLabel}>Seed</span>
            <input
              style={s.input}
              type="number"
              value={zone.seed ?? ''}
              placeholder="auto"
              onChange={(e) =>
                onChange({
                  seed: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                })
              }
            />
          </label>
        </>
      )}

      {isBoundary && (
        <div style={s.hint}>
          Project boundary defines the study area used for overall statistics in Scene.
        </div>
      )}
    </>
  );
}

function BuildingInspector({
  building,
  units,
  onChange,
}: {
  building: import('../domain/zones').GeneratedBuilding;
  units: 'm' | 'ft';
  onChange: (patch: Partial<import('../domain/zones').GeneratedBuilding>) => void;
}) {
  return (
    <>
      <div style={s.name}>{building.type} · {building.buildForm}</div>
      <div style={s.section}>Massing</div>
      <Row label="Floors" value={String(building.floors)} />
      <Row label="Height" value={formatM(building.heightM, units)} />
      <label style={s.field}>
        <span style={s.fieldLabel}>Floors</span>
        <input
          style={s.input}
          type="number"
          min={1}
          max={100}
          value={building.floors}
          onChange={(e) => {
            const floors = Math.max(1, parseInt(e.target.value, 10) || 1);
            onChange({ floors, heightM: floors * 3.2 });
          }}
        />
      </label>
      <div style={s.hint}>Delete / Backspace removes this building</div>
    </>
  );
}

function OsmInspector({
  label,
  osmKind,
  tags,
}: {
  label: string;
  osmKind: string;
  tags: Record<string, string>;
}) {
  const entries = Object.entries(tags).filter(([k]) => !k.startsWith('_'));
  return (
    <>
      <div style={s.name}>{label}</div>
      <div style={s.section}>Kind</div>
      <Row label="Type" value={osmKind} />
      <div style={s.section}>OSM tags</div>
      {entries.length === 0 && <div style={s.hint}>No tags</div>}
      {entries.slice(0, 24).map(([k, v]) => (
        <Row key={k} label={k} value={v} />
      ))}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={s.rowValue}>{value}</span>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute',
    right: 16,
    top: 56,
    width: 280,
    maxHeight: 'calc(100% - 80px)',
    overflowY: 'auto',
    padding: 14,
    borderRadius: 14,
    background: 'rgba(44,44,46,0.88)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
    zIndex: 26,
    pointerEvents: 'auto',
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: 600 },
  close: {
    border: 'none',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    borderRadius: 6,
    width: 24,
    height: 24,
    cursor: 'pointer',
    fontSize: 11,
  },
  name: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  section: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    opacity: 0.45,
    margin: '12px 0 6px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    marginBottom: 4,
  },
  rowLabel: { opacity: 0.55, flexShrink: 0 },
  rowValue: {
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    wordBreak: 'break-word',
  },
  seg: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
  segWrap: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
  segBtn: {
    flex: 1,
    border: 'none',
    borderRadius: 8,
    padding: '6px 4px',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    cursor: 'pointer',
  },
  segOn: {
    background: 'rgba(72,72,74,0.98)',
    color: '#f5f5f7',
    fontWeight: 600,
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
    fontSize: 12,
  },
  fieldLabel: { opacity: 0.6 },
  input: {
    flex: 1,
    maxWidth: 140,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#f5f5f7',
    fontSize: 12,
    padding: '5px 8px',
  },
  select: {
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    padding: '4px 6px',
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    marginBottom: 8,
    cursor: 'pointer',
  },
  hint: {
    fontSize: 11,
    opacity: 0.4,
    lineHeight: 1.4,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    border: 'none',
    borderRadius: 8,
    padding: '8px 10px',
    background: 'rgba(10,132,255,0.85)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionBtnGhost: {
    flex: 1,
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    padding: '8px 10px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    cursor: 'pointer',
  },
};
