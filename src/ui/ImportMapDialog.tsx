import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BBox } from '../domain/SceneOrigin';
import { approxBboxSizeM } from '../domain/SceneOrigin';

/** Max bbox edge ~2.5 km to keep Overpass and mesh count reasonable. */
const MAX_EDGE_M = 2500;

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
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [sizeHint, setSizeHint] = useState<string>('');

  useEffect(() => {
    if (!open || !mapDivRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const applyViewAsBbox = () => {
      const b = map.getBounds();
      const next: BBox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      setBbox(next);
      const size = approxBboxSizeM(next);
      setSizeHint(
        `\u2248 ${(size.widthM / 1000).toFixed(2)} \u00d7 ${(size.heightM / 1000).toFixed(2)} km`
      );
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

    map.whenReady(applyViewAsBbox);
    map.on('moveend', applyViewAsBbox);
    mapRef.current = map;

    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.off('moveend', applyViewAsBbox);
      map.remove();
      mapRef.current = null;
      rectRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const size = bbox ? approxBboxSizeM(bbox) : null;
  const tooLarge =
    size != null && (size.widthM > MAX_EDGE_M || size.heightM > MAX_EDGE_M);

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>Import map fragment</span>
          <button type="button" style={styles.closeBtn} onClick={onClose} disabled={loading}>
            \u00d7
          </button>
        </div>
        <p style={styles.hint}>
          Pan and zoom to the area you want. The visible view becomes the scene
          base layer (OSM buildings + roads).
        </p>
        <div ref={mapDivRef} style={styles.map} />
        <div style={styles.footer}>
          <span style={styles.meta}>
            {sizeHint}
            {tooLarge && (
              <span style={styles.warn}> \u2014 too large, zoom in (max ~2.5 km)</span>
            )}
          </span>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.actions}>
            <button type="button" style={styles.secondary} onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="button"
              style={styles.primary}
              disabled={!bbox || tooLarge || loading}
              onClick={() => bbox && onImport(bbox)}
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
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  panel: {
    width: 'min(720px, 94vw)',
    background: '#2c2c2e',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
    color: '#f5f5f7',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: '1px solid #3a3a3c',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#98989d',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px',
  },
  hint: {
    margin: 0,
    padding: '10px 18px 0',
    fontSize: 13,
    color: '#98989d',
    lineHeight: 1.4,
  },
  map: {
    height: 380,
    margin: '12px 18px',
    borderRadius: 8,
    overflow: 'hidden',
  },
  footer: {
    padding: '0 18px 16px',
  },
  meta: {
    fontSize: 12,
    color: '#98989d',
  },
  warn: {
    color: '#ff9f0a',
  },
  error: {
    marginTop: 8,
    fontSize: 13,
    color: '#ff453a',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  primary: {
    background: '#0a84ff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondary: {
    background: '#3a3a3c',
    color: '#f5f5f7',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
};
