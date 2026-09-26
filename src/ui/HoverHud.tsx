import type { CSSProperties } from 'react';

export interface HoverInfo {
  kind: 'building' | 'road' | 'water' | 'green' | 'other';
  label: string;
  detail?: string;
}

interface Props {
  info: HoverInfo | null;
  x: number;
  y: number;
}

export function HoverHud({ info, x, y }: Props) {
  if (!info) return null;
  return (
    <div
      style={{
        ...s.tip,
        left: x + 14,
        top: y + 14,
      }}
    >
      <div style={s.kind}>{info.kind}</div>
      <div style={s.label}>{info.label}</div>
      {info.detail && <div style={s.detail}>{info.detail}</div>}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  tip: {
    position: 'fixed',
    zIndex: 40,
    pointerEvents: 'none',
    padding: '8px 10px',
    borderRadius: 10,
    background: 'rgba(28,28,30,0.92)',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
    maxWidth: 220,
  },
  kind: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    opacity: 0.45,
    marginBottom: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
  },
  detail: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 2,
  },
};
