import type { CSSProperties } from 'react';

interface Props {
  onImport: () => void;
}

export function EmptyState({ onImport }: Props) {
  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.icon}>\u25CE</div>
        <h1 style={s.title}>Import a map fragment</h1>
        <p style={s.body}>
          Choose an area on OpenStreetMap. Buildings, roads, water and parks become a live 3D
          context for your design.
        </p>
        <button type="button" style={s.cta} onClick={onImport}>
          Import map
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
    maxWidth: '90vw',
    padding: '32px 28px',
    borderRadius: 20,
    background: 'rgba(44,44,46,0.78)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
    textAlign: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  icon: {
    fontSize: 36,
    opacity: 0.85,
    marginBottom: 12,
    color: '#0a84ff',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 20,
    fontWeight: 600,
    color: '#f5f5f7',
    letterSpacing: '-0.02em',
  },
  body: {
    margin: '0 0 20px',
    fontSize: 14,
    lineHeight: 1.45,
    color: 'rgba(255,255,255,0.55)',
  },
  cta: {
    border: 'none',
    borderRadius: 10,
    padding: '10px 22px',
    background: '#0a84ff',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
