import Link from 'next/link';
import { radar, showcase } from '@polyradar/db/queries/entities';
import { DomainMap } from './components/DomainMap';
import { EventCard } from './components/EventCard';
import { coreLibraries, insightsFor, mapEntities } from '@/lib/data';
import { lastCompleteWeek, mediaUrl, weekContaining, weekTitle, ymd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const { from, to } = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekContaining(new Date(`${week}T00:00:00Z`)) : lastCompleteWeek();
  const prev = ymd(new Date(from.getTime() - 7 * 86400_000));
  const next = to.getTime() <= Date.now() ? ymd(to) : null;

  const [events, gallery, libs] = await Promise.all([radar(from, to), showcase(4), coreLibraries()]);
  const radarSlugs = new Set(events.map((e) => e.entity_slug).filter((s): s is string => !!s));
  const showSlugs = new Set(gallery.map((e) => e.entity_slug).filter((s): s is string => !!s && !radarSlugs.has(s)));
  const [entities, insights] = await Promise.all([mapEntities(radarSlugs, showSlugs), insightsFor([...radarSlugs])]);

  return (
    <>
      <section aria-label="领域地图" className="map">
        <DomainMap entities={entities} />
        <div className="map-overlay">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="h1">{weekTitle(from)}</h1>
            <Link href={`/?week=${prev}`} className="btn" aria-label="上一周" style={{ width: 44, padding: 0, justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            </Link>
            {next && (
              <Link href={`/?week=${next}`} className="btn" aria-label="下一周" style={{ width: 44, padding: 0, justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" aria-labelledby="radar-h">
        <div className="section-head">
          <h2 id="radar-h" className="h2">本周雷达</h2>
          <Link href="/feed.json" className="more">JSON FEED →</Link>
        </div>
        {events.length ? (
          <div className="grid-2">
            {events.map((ev) => (
              <EventCard key={ev.id} ev={ev} insight={ev.entity_slug ? insights.get(ev.entity_slug) : undefined}
                author={typeof ev.payload.author === 'string' ? ev.payload.author : null} />
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>这一周没有达到决策价值门槛的条目。</p>
        )}
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" aria-labelledby="show-h">
        <div className="section-head">
          <h2 id="show-h" className="h2">展示</h2>
          <Link href="/showcase" className="more">全部作品 →</Link>
        </div>
        <div className="grid-2">
          {gallery.filter((ev) => !radarSlugs.has(ev.entity_slug ?? '')).slice(0, 2).map((ev) => (
            <Link key={ev.id} href={`/e/${ev.entity_slug}`} className="card">
              <span className="card-media">{ev.media_path && <img src={mediaUrl(ev.media_path)!} alt={ev.entity_name ?? ''} />}</span>
              <span style={{ padding: '18px 24px 20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{ev.entity_name}</span>
                <span className="path">{ev.capabilities[0]}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 40 }}>
        <div>
          <h2 className="h3" style={{ marginBottom: 20 }}>核心库</h2>
          <div className="rows mono">
            {libs.map((l) => (
              <Link key={l.slug} href={l.version ? '/api-changes/three' : `/e/${l.slug}`}>
                <span>{l.name}</span>
                <span className="muted">{l.version ?? '未追踪'}</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h2 className="h3" style={{ marginBottom: 20 }}>订阅</h2>
          <div className="pills">
            <Link className="btn mono" href="/feed.json">JSON Feed</Link>
            <Link className="btn mono" href="/llms.txt">llms.txt</Link>
            <Link className="btn btn-dark mono" href="/agents">MCP</Link>
          </div>
        </div>
      </section>
    </>
  );
}
