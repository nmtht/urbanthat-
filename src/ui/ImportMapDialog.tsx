import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BBox } from '../domain/SceneOrigin';
import { approxBboxSizeM } from '../domain/SceneOrigin';

/** Max bbox edge ~5 km. */
const MAX_EDGE_M = 5000;

export interface ImportMapDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (bbox: BBox) => void;
  loading?: boolean;
  error?: string | null;
}

const DEFAULT_CENTER: [number, number] = [55.75, 37.62];
const DEFAULT_ZOOM = 14;

export function ImportMapDialog({
  open,
  onClose,
  onImport,
  loading,
  error,
}: ImportMapDialogProps) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const [sizeLabel, setSizeLabel] = useState('');
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    if (!open || !mapDiv.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDiv.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 19,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const updateRect = () => {
      const b = map.getBounds();
      const bbox: BBox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      const size = approxBboxSizeM(bbox);
      setSizeLabel(
        `\u2248 ${(size.widthM / 1000).toFixed(2)} \u00d7 ${(size.heightM / 1000).toFixed(2)} km`
      );
      const large = size.widthM > MAX_EDGE_M || size.heightM > MAX_EDGE_M;
      setTooLarge(large);
      if (rectRef.current) {
        rectRef.current.setBounds(b);
      } else {
        rectRef.current = L.rectangle(b, {
          color: '#0a84ff',
          weight: 2,
          fillOpacity: 0.08,
        }).addTo(map);
      }
    };

    map.on('moveend', updateRect);
    map.on('zoomend', updateRect);
    updateRect();
    mapRef.current = map;

    return () => {
      map.off('moveend', updateRect);
      map.off('zoomend', updateRect);
      map.remove();
      mapRef.current = null;
      rectRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const handleImport = () => {
    const map = mapRef.current;
    if (!map || tooLarge || loading) return;
    const b = map.getBounds();
    onImport({
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.head}>
          <span style={styles.title}>Import map fragment</span>
          <button type="button" style={styles.close} onClick={onClose} disabled={!!loading}>
            {'\u00d7'}
          </button>
        </div>
        <div ref={mapDiv} style={styles.map} />
        <div style={styles.footer}>
          <span style={styles.size}>
            {sizeLabel}
            {tooLarge && (
              <span style={styles.warn}> {'\u2014'} too large, zoom in (max ~5 km)</span>
            )}
          </span>
          {error && <div style={styles.err}>{error}</div>}
          <div style={styles.actions}>
            <button type="button" style={styles.secondary} onClick={onClose} disabled={!!loading}>
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...styles.primary,
                opacity: tooLarge || loading ? 0.5 : 1,
              }}
              onClick={handleImport}
              disabled={tooLarge || !!loading}
            >
              {loading ? 'Loading\u2026' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    pointerEvents: 'auto',
  },
  card: {
    width: 'min(720px, 92vw)',
    borderRadius: 16,
    overflow: 'hidden',
    background: 'rgba(44,44,46,0.95)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    color: '#f5f5f7',
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
  },
  title: { fontSize: 16, fontWeight: 600 },
  close: {
    border: 'none',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    borderRadius: 6,
    width: 28,
    height: 28,
    cursor: 'pointer',
    fontSize: 16,
  },
  map: { height: 360, width: '100%' },
  footer: { padding: '12px 16px 16px' },
  size: { fontSize: 12, opacity: 0.7 },
  warn: { color: '#ff9f0a' },
  err: { color: '#ff453a', fontSize: 12, marginTop: 6 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  secondary: {
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    cursor: 'pointer',
  },
  primary: {
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    background: 'rgba(72,72,74,0.98)',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
