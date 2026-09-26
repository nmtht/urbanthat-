import type { CSSProperties } from 'react';

interface Counts {
  buildingCount: number;
  roadCount: number;
  waterCount: number;
  greenCount: number;
  treeCount: number;
}

interface Props {
  counts: Counts | null;
  loading?: boolean;
  message?: string;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function StatusChip({ counts, loading, message }: Props) {
  if (loading) {
    return <div style={s.chip}>Fetching OSM\u2026</div>;
  }
  if (!counts) {
    return <div style={s.chipMuted}>{message ?? 'Urban That'}</div>;
  }
  const tip = [
    `${counts.buildingCount} buildings`,
    `${counts.roadCount} roads`,
    `${counts.waterCount} water`,
    `${counts.greenCount} green`,
    `${counts.treeCount} trees`,
  ].join(' \u00b7 ');

  return (
    <div style={s.chip} title={tip}>
      <span>{fmt(counts.buildingCount)} bld</span>
      <span style={s.dot}>\u00b7</span>
      <span>{fmt(counts.roadCount)} roads</span>
      {counts.waterCount > 0 && (
        <>
          <span style={s.dot}>\u00b7</span>
          <span>{fmt(counts.waterCount)} water</span>
        </>
      )}
      {counts.treeCount > 0 && (
        <>
          <span style={s.dot}>\u00b7</span>
          <span>{fmt(counts.treeCount)} trees</span>
        </>
      )}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    borderRadius: 20,
    background: 'rgba(44,44,46,0.72)',
    backdropFilter: 'blur(16px)',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
    letterSpacing: '-0.01em',
    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
    maxWidth: '100%',
  },
  chipMuted: {
    display: 'inline-flex',
    padding: '6px 12px',
    borderRadius: 20,
    background: 'rgba(44,44,46,0.5)',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
  dot: {
    opacity: 0.4,
    margin: '0 2px',
  },
};
