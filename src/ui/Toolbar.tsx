import type { CSSProperties } from 'react';

export type ToolId = 'select' | 'delete' | 'road' | 'zone' | 'import';

interface Props {
  active: ToolId;
  onChange: (id: ToolId) => void;
  onImport: () => void;
  disabled?: boolean;
}

const ITEMS: Array<{ id: ToolId; label: string; title: string }> = [
  { id: 'select', label: 'Select', title: 'Select (V)' },
  { id: 'delete', label: 'Delete', title: 'Delete tool — click to remove (Del)' },
  { id: 'road', label: 'Road', title: 'Road brush (soon)' },
  { id: 'zone', label: 'Zone', title: 'Zone brush (soon)' },
  { id: 'import', label: 'Import', title: 'Import map fragment' },
];

const FALLBACK: Record<ToolId, string> = {
  select: '\u232A',
  delete: '\u232B',
  road: '\u2550',
  zone: '\u25A2',
  import: '\u2193',
};

export function Toolbar({ active, onChange, onImport, disabled }: Props) {
  return (
    <div style={s.bar} role="toolbar" aria-label="Tools">
      {ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.title}
            disabled={disabled && item.id !== 'import'}
            style={{
              ...s.btn,
              ...(isActive ? s.btnActive : null),
            }}
            onClick={() => {
              if (item.id === 'import') onImport();
              else onChange(item.id);
            }}
          >
            <span style={s.icon} aria-hidden>
              {FALLBACK[item.id]}
            </span>
            <span style={s.label}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  bar: {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 6,
    borderRadius: 14,
    background: 'rgba(44,44,46,0.72)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.12)',
    pointerEvents: 'auto',
    zIndex: 20,
  },
  btn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    width: 56,
    padding: '10px 6px',
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  btnActive: {
    background: 'rgba(72,72,74,0.98)',
    color: '#f5f5f7',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
  },
  icon: {
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 500,
  },
  label: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
};
