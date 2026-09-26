import type { CSSProperties } from 'react';

export type OsmQuality = 'low' | 'med' | 'high';

interface Props {
  open: boolean;
  onClose: () => void;
  hour: number;
  onHour: (h: number) => void;
  quality: OsmQuality;
  onQuality: (q: OsmQuality) => void;
  showTrees: boolean;
  onShowTrees: (v: boolean) => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  showNorth: boolean;
  onShowNorth: (v: boolean) => void;
  units: 'm' | 'ft';
  onUnits: (u: 'm' | 'ft') => void;
}

export function ScenePanel(props: Props) {
  if (!props.open) return null;
  const hourLabel = `${String(Math.floor(props.hour)).padStart(2, '0')}:${props.hour % 1 >= 0.5 ? '30' : '00'}`;

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <span style={s.title}>Scene</span>
        <button type="button" style={s.close} onClick={props.onClose} aria-label="Close">
          \u2715
        </button>
      </div>

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

      <div style={s.section}>OSM quality</div>
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

      <label style={s.check}>
        <input
          type="checkbox"
          checked={props.showTrees}
          onChange={(e) => props.onShowTrees(e.target.checked)}
        />
        Show trees
      </label>
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
        {(['m', 'ft'] as const).map((u) => (
          <button
            key={u}
            type="button"
            style={{ ...s.segBtn, ...(props.units === u ? s.segOn : null) }}
            onClick={() => props.onUnits(u)}
          >
            {u === 'm' ? 'Metres' : 'Feet'}
          </button>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute',
    right: 16,
    top: 56,
    width: 260,
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
  rowLabel: { opacity: 0.6 },
  rowValue: { fontVariantNumeric: 'tabular-nums' },
  slider: { width: '100%', accentColor: '#0a84ff', marginBottom: 12 },
  section: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    opacity: 0.45,
    margin: '10px 0 6px',
  },
  seg: { display: 'flex', gap: 4, marginBottom: 8 },
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
    background: 'rgba(10,132,255,0.95)',
    color: '#fff',
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
};
