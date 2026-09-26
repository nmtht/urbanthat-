import type { CSSProperties } from 'react';

interface Props {
  visible: boolean;
  yawDeg?: number;
}

export function NorthArrow({ visible, yawDeg = 0 }: Props) {
  if (!visible) return null;
  const rot = -yawDeg;
  return (
    <div style={s.wrap} title="North">
      <div style={{ ...s.rose, transform: `rotate(${rot}deg)` }}>
        <div style={s.arrow}>\u25B2</div>
        <div style={s.n}>N</div>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    right: 170,
    bottom: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    background: 'rgba(44,44,46,0.78)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    pointerEvents: 'none',
    color: '#f5f5f7',
    fontFamily: '-apple-system, system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  rose: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'transform 0.08s linear',
  },
  arrow: { fontSize: 11, lineHeight: 1, color: '#ff453a' },
  n: { fontSize: 10, fontWeight: 700, marginTop: 1 },
};
