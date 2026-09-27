import type { CSSProperties } from 'react';
import type { SceneStats } from '../domain/stats';
import { formatM, formatArea } from '../domain/stats';
import { ZONE_LABELS, type ZoneType } from '../domain/zones';

/** Model detail tier (not just OSM fetch). */
export type ModelQuality = 'low' | 'med' | 'high';
/** @deprecated use ModelQuality */
export type OsmQuality = ModelQuality;

interface Props {
  open: boolean;
  onClose: () => void;
  hour: number;
  onHour: (h: number) => void;
  quality: ModelQuality;
  onQuality: (q: ModelQuality) => void;
  fogAmount: number;
  onFogAmount: (v: number) => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  showNorth: boolean;
  onShowNorth: (v: boolean) => void;
  units: 'm' | 'ft';
  onUnits: (u: 'm' | 'ft') => void;
  stats?: SceneStats | null;
}

const QUALITY_HINT: Record<ModelQuality, string> = {
  low: 'Massing only · primitive roads',
  med: 'Floor bands · flat roads · no trees',
  high: 'Facades · trees · street lamps · night lights',
};

export function ScenePanel(props: Props) {
  if (!props.open) return null;
  const hourLabel = `${String(Math.floor(props.hour)).padStart(2, '0')}:${props.hour % 1 >= 0.5 ? '30' : '00'}`;
  const st = props.stats;
  const u = props.units;

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <span style={s.title}>Scene</span>
        <button type="button" style={s.close} onClick={props.onClose} aria-label="Close">
          {'\u2715'}
        </button>
      </div>

      <div style={s.section}>Statistics</div>
      {st ? (
        <>
          <Row
            label="Boundary"
            value={
              st.boundaryAreaM2 != null ? formatArea(st.boundaryAreaM2, u) : 'not set'
            }
          />
          <Row label="Roads" value={`${st.roadCount} · ${formatM(st.roadLengthM, u)}`} />
          <Row label="Zones" value={`${st.zoneCount} · ${formatArea(st.zoneAreaM2, u)}`} />
          {Object.entries(st.byType).map(([t, v]) => (
            <Row
              key={t}
              label={ZONE_LABELS[t as ZoneType] ?? t}
              value={`${v.count} · ${formatArea(v.areaM2, u)}`}
            />
          ))}
          {st.boundaryAreaM2 == null && (
            <div style={s.hint}>
              Draw a zone with type Boundary to define the study area for totals.
            </div>
          )}
        </>
      ) : (
        <div style={s.hint}>No content yet</div>
      )}

      <label style={s.row}>
        <span style={s.rowLabel}>Time</span>
        <span style={s.rowValue}>{hourLabel}</span>
      </label>
      <input
        type="range"
        min={0}
        max={24}
        step={0.25}
        value={props.hour}
        onChange={(e) => props.onHour(parseFloat(e.target.value))}
        style={s.slider}
      />

      <div style={s.section}>Model quality</div>
      <div style={s.seg}>
        {(['low', 'med', 'high'] as const).map((q) => (
          <button
            key={q}
            type="button"
            style={{ ...s.segBtn, ...(props.quality === q ? s.segOn : null) }}
            onClick={() => props.onQuality(q)}
          >
            {q === 'low' ? 'Low' : q === 'med' ? 'Med' : 'High'}
          </button>
        ))}
      </div>
      <div style={s.hint}>{QUALITY_HINT[props.quality]}</div>

      <div style={s.section}>Atmosphere</div>
      <label style={s.row}>
        <span style={s.rowLabel}>Fog</span>
        <span style={s.rowValue}>{Math.round(props.fogAmount * 100)}%</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={props.fogAmount}
        onChange={(e) => props.onFogAmount(parseFloat(e.target.value))}
        style={s.slider}
      />

      <label style={s.check}>
        <input
          type="checkbox"
          checked={props.showGrid}
          onChange={(e) => props.onShowGrid(e.target.checked)}
        />
        Show grid
      </label>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={props.showNorth}
          onChange={(e) => props.onShowNorth(e.target.checked)}
        />
        North arrow
      </label>

      <div style={s.section}>Units</div>
      <div style={s.seg}>
        {(['m', 'ft'] as const).map((uOpt) => (
          <button
            key={uOpt}
            type="button"
            style={{ ...s.segBtn, ...(props.units === uOpt ? s.segOn : null) }}
            onClick={() => props.onUnits(uOpt)}
          >
            {uOpt === 'm' ? 'Metres' : 'Feet'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statRow}>
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
    width: 260,
    maxHeight: 'calc(100% - 80px)',
    overflowY: 'auto',
    padding: 14,
    borderRadius: 14,
    background: 'rgba(44,44,46,0.82)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
    zIndex: 25,
    pointerEvents: 'auto',
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    marginBottom: 4,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    marginBottom: 3,
  },
  rowLabel: { opacity: 0.6 },
  rowValue: { fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
  slider: { width: '100%', accentColor: '#0a84ff', marginBottom: 12 },
  section: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    opacity: 0.45,
    margin: '10px 0 6px',
  },
  seg: { display: 'flex', gap: 4, marginBottom: 4 },
  segBtn: {
    flex: 1,
    border: 'none',
    borderRadius: 8,
    padding: '7px 0',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    cursor: 'pointer',
  },
  segOn: {
    background: 'rgba(72,72,74,0.98)',
    color: '#f5f5f7',
    fontWeight: 600,
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
    lineHeight: 1.35,
    marginBottom: 6,
  },
};
