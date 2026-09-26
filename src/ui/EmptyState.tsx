import type { CSSProperties } from 'react';

interface Props {
  onImport: () => void;
}

export function EmptyState({ onImport }: Props) {
  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.icon}>◎</div>
        <div style={s.title}>Import map fragment</div>
        <div style={s.sub}>
          Pick a bbox on the map to load OSM buildings, roads, water and greenery as muted context.
        </div>
        <button type="button" style={s.btn} onClick={onImport}>
          Import map fragment
        </button>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 15,
  },
  card: {
    pointerEvents: 'auto',
    width: 360,
    padding: '28px 28px 24px',
    borderRadius: 16,
    background: 'rgba(44,44,46,0.88)',
    backdropFilter: 'blur(24px) saturate(1.4)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    textAlign: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
  },
  icon: {
    fontSize: 36,
    marginBottom: 12,
    opacity: 0.85,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    lineHeight: 1.45,
    opacity: 0.65,
    marginBottom: 20,
  },
  btn: {
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    background: 'rgba(72,72,74,0.98)',
    color: '#f5f5f7',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
