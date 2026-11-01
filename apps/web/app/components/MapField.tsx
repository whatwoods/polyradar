'use client';
// The map's halftone field: ~1,200 decorative dots. Drawn on a canvas in the
// browser so the server doesn't render (twice, HTML + RSC) an element per dot.
import { useEffect, useRef } from 'react';
import { halftoneField } from '@/lib/map-field';

export function MapField({ counts }: { counts: Record<string, number> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const field = halftoneField(counts);
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const g = canvas.getContext('2d');
      if (!g) return;
      g.scale(dpr, dpr);
      for (const d of field) {
        g.fillStyle = d.c;
        g.beginPath();
        g.arc((d.x / 100) * width, (d.y / 100) * height, d.s / 2, 0, Math.PI * 2);
        g.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [counts]);

  return <canvas ref={ref} className="map-field" aria-hidden="true" />;
}
