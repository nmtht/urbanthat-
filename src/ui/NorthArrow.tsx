import type { CSSProperties } from 'react';

export function NorthArrow({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div style={s.wrap} title="North">
      <div style={s.arrow}>\u25B2</div>
      <div style={s.n}>N</div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    right: 170,
    bottom: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    background: 'rgba(44,44,46,0.75)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    pointerEvents: 'none',
    color: '#f5f5f7',
    fontFamily: '-apple-system, system-ui, sans-serif',
  },
  arrow: { fontSize: 10, lineHeight: 1, color: '#ff453a' },
  n: { fontSize: 10, fontWeight: 700, marginTop: 1 },
};
