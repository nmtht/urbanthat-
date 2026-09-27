import type { CSSProperties } from 'react';

interface Props {
  onImport: () => void;
  onStartEmpty?: () => void;
}

export function EmptyState({ onImport, onStartEmpty }: Props) {
  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <button
          type="button"
          style={s.close}
          title="Close and start empty"
          onClick={() => onStartEmpty?.()}
          aria-label="Close"
        >
          ×
        </button>
        <div style={s.icon}>◎</div>
        <div style={s.title}>Urban That</div>
        <div style={s.sub}>
          Import an OSM map fragment as context, or start on an empty ground plane and draw roads
          right away.
        </div>
        <div style={s.actions}>
          <button type="button" style={s.btnPrimary} onClick={onImport}>
            Import map fragment
          </button>
          <button type="button" style={s.btnGhost} onClick={() => onStartEmpty?.()}>
            Start empty
          </button>
        </div>
        <div style={s.hint}>R — road · Z — zone · V — select</div>
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
    position: 'relative',
    pointerEvents: 'auto',
    width: 380,
    padding: '28px 28px 22px',
    borderRadius: 16,
    background: 'rgba(44,44,46,0.88)',
    backdropFilter: 'blur(24px) saturate(1.4)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    textAlign: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
  },
  close: {
    position: 'absolute',
    top: 10,
    right: 12,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '4px 8px',
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
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'stretch',
  },
  btnPrimary: {
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    background: 'rgba(72,72,74,0.98)',
    color: '#f5f5f7',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnGhost: {
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: '10px 18px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  hint: {
    marginTop: 14,
    fontSize: 11,
    opacity: 0.4,
  },
};
