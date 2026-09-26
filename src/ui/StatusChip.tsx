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
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function StatusChip({ counts, loading, message }: Props) {
  if (loading) {
    return <div style={s.chip}>Fetching OSM…</div>;
  }
  if (!counts) {
    return (
      <div style={s.chip}>
        <span style={s.brand}>{message ?? 'Urban That'}</span>
      </div>
    );
  }
  const parts = [
    `${fmt(counts.buildingCount)} bld`,
    `${fmt(counts.roadCount)} roads`,
  ];
  if (counts.waterCount) parts.push(`${fmt(counts.waterCount)} water`);
  if (counts.greenCount) parts.push(`${fmt(counts.greenCount)} green`);
  if (counts.treeCount) parts.push(`${fmt(counts.treeCount)} trees`);
  const text = parts.join(' · ');

  return (
    <div style={s.chip} title={text}>
      <span style={s.brand}>{message ?? 'Urban That'}</span>
      <span style={s.dot}>·</span>
      <span style={s.counts}>{text}</span>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 20,
    background: 'rgba(44,44,46,0.78)',
    backdropFilter: 'blur(12px)',
    color: '#f5f5f7',
    fontSize: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    pointerEvents: 'auto',
    maxWidth: 420,
    overflow: 'hidden',
  },
  brand: { fontWeight: 600, opacity: 0.9 },
  dot: { opacity: 0.35 },
  counts: { opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
};
