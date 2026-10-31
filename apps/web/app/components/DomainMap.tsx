import Link from 'next/link';
import { hash01 } from '@/lib/format';

export interface MapEntity { slug: string; name: string; top: string; mark: 'radar' | 'showcase' | null }

// Where each top-level capability sits on the map (percent of width/height).
const CLUSTERS: Record<string, { x: number; y: number; zh: string }> = {
  render: { x: 22, y: 62, zh: '渲染' },
  procgen: { x: 46, y: 76, zh: '程序化生成' },
  asset: { x: 70, y: 40, zh: 'AI 资产' },
  gamecreation: { x: 86, y: 74, zh: '游戏创作' },
  interaction: { x: 52, y: 40, zh: '交互' },
  benchmark: { x: 34, y: 86, zh: '基准测试' },
};

/**
 * Halftone density field of the domain: each lattice dot grows with the number
 * of tracked entities in nearby capability clusters. Entities sit on top.
 */
export function DomainMap({ entities }: { entities: MapEntity[] }) {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.top, (counts.get(e.top) ?? 0) + 1);

  const field: { x: number; y: number; s: number; c: string }[] = [];
  for (let gx = 1; gx < 60; gx++) {
    for (let gy = 6; gy < 25; gy++) {
      const x = gx * (100 / 60);
      const y = gy * 4;
      let v = 0;
      for (const [top, c] of Object.entries(CLUSTERS)) {
        const n = counts.get(top) ?? 0;
        const d2 = ((x - c.x) / 14) ** 2 + ((y - c.y) / 22) ** 2;
        v += (0.35 + Math.log1p(n)) * Math.exp(-d2);
      }
      if (v < 0.12) continue;
      const s = Math.min(6, 1.5 + v * 2.4);
      field.push({ x, y, s, c: v > 1.4 ? '#8E8A82' : v > 0.6 ? '#B3AFA6' : '#D2CEC6' });
    }
  }

  const placed = entities.map((e) => {
    const c = CLUSTERS[e.top] ?? { x: 50, y: 60 };
    return {
      ...e,
      x: c.x + (hash01(e.slug, 1) - 0.5) * 18,
      y: c.y + (hash01(e.slug, 2) - 0.5) * 22,
    };
  });

  return (
    <>
      {field.map((d, i) => (
        <span key={i} className="map-dot" aria-hidden="true"
          style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s, background: d.c }} />
      ))}
      {Object.entries(CLUSTERS).map(([top, c]) => (
        <Link key={top} href={`/search?cap=${top}`} className="map-label" style={{ left: `${c.x}%`, top: `${Math.min(94, c.y + 13)}%` }}>
          {c.zh}
        </Link>
      ))}
      {placed.filter((e) => !e.mark).map((e) => (
        <Link key={e.slug} href={`/e/${e.slug}`} className="map-dot" title={e.name} aria-label={e.name}
          style={{ left: `${e.x}%`, top: `${e.y}%`, width: 8, height: 8, background: '#5E5B55' }} />
      ))}
      {placed.filter((e) => e.mark).map((e) => (
        <Link key={e.slug} href={`/e/${e.slug}`} className={`map-entity${e.mark === 'showcase' ? ' ring' : ''}${e.x > 66 ? ' flip' : ''}`}
          style={{ left: `${e.x}%`, top: `${e.y}%` }}>
          <span className="pin" />
          <span className="name">{e.name}</span>
        </Link>
      ))}
    </>
  );
}
