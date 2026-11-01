import Link from 'next/link';
import { hash01 } from '@/lib/format';
import { CLUSTERS } from '@/lib/map-field';
import { MapField } from './MapField';

export interface MapEntity { slug: string; name: string; top: string; mark: 'radar' | 'showcase' | null }

/**
 * The domain map: a halftone density field (MapField) under cluster labels and
 * entities.
 */
export function DomainMap({ entities }: { entities: MapEntity[] }) {
  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.top] = (counts[e.top] ?? 0) + 1;

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
      <MapField counts={counts} />
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
