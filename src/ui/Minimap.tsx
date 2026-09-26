import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { BBox } from '../domain/SceneOrigin';

interface Props {
  bbox: BBox | null;
  visible: boolean;
}

export function Minimap({ bbox, visible }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bbox || !visible) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(28,28,30,0.9)';
    ctx.beginPath();
    // roundRect may need fallback
    if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: Function }).roundRect === 'function') {
      (ctx as CanvasRenderingContext2D & { roundRect: Function }).roundRect(0, 0, w, h, 10);
    } else {
      ctx.rect(0, 0, w, h);
    }
    ctx.fill();

    const pad = 14;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

    const latSpan = Math.max(bbox.north - bbox.south, 1e-6);
    const lonSpan = Math.max(bbox.east - bbox.west, 1e-6);
    const scale = 0.55;
    const drawW = (w - pad * 2) * scale;
    const drawH = (h - pad * 2) * scale * (latSpan / lonSpan);
    const dw = Math.min(drawW, (w - pad * 2) * 0.7);
    const dh = Math.min(Math.max(drawH, 20), (h - pad * 2) * 0.7);
    const x = (w - dw) / 2;
    const y = (h - dh) / 2;

    ctx.fillStyle = 'rgba(10,132,255,0.35)';
    ctx.strokeStyle = 'rgba(10,132,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, dw, dh);
    ctx.strokeRect(x, y, dw, dh);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 10px -apple-system, system-ui, sans-serif';
    ctx.fillText('N', w / 2 - 4, pad + 10);
    ctx.beginPath();
    ctx.moveTo(w / 2, pad + 12);
    ctx.lineTo(w / 2, pad + 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();
  }, [bbox, visible]);

  if (!visible || !bbox) return null;

  return (
    <div style={s.wrap}>
      <canvas ref={ref} width={140} height={140} style={s.canvas} />
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    zIndex: 20,
    pointerEvents: 'none',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  },
  canvas: {
    display: 'block',
    borderRadius: 12,
  },
};
