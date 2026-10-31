import Link from 'next/link';
import { showcase } from '@polyradar/db/queries/entities';
import { md, mediaUrl } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: '展示' };

export default async function ShowcasePage() {
  const items = await showcase(48);
  const [featured, ...rest] = items;
  return (
    <>
      <section className="section" style={{ paddingBottom: 32 }}>
        <h1 className="h1">展示</h1>
      </section>

      {featured && (
        <section className="section-flush">
          <article className="card" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Link href={`/e/${featured.entity_slug}`} className="card-media" style={{ flex: '3 1 520px', minHeight: 340, aspectRatio: 'auto' }}>
              {featured.media_path && <img src={mediaUrl(featured.media_path)!} alt={featured.entity_name ?? ''} style={{ position: 'absolute', inset: 0 }} />}
            </Link>
            <div style={{ flex: '2 1 320px', minWidth: 0, padding: 32, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="path">{featured.capabilities.join(' · ')}</div>
              <h2 className="h3">{featured.entity_name}</h2>
              <p className="muted" style={{ margin: 0 }}>{featured.summary_zh}</p>
              <div className="card-foot" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  {typeof featured.payload.author === 'string' ? `${featured.payload.author} · ` : ''}{md(new Date(featured.occurred_at))}
                </span>
                <span className="pills">
                  <Link className="btn btn-dark" href={`/e/${featured.entity_slug}`}>详情</Link>
                  {featured.source_url && <a className="btn" href={featured.source_url} target="_blank" rel="noreferrer">原帖</a>}
                </span>
              </div>
            </div>
          </article>
        </section>
      )}

      <div className="hatch" aria-hidden="true" />

      <section className="section">
        <div className="grid-3">
          {rest.map((ev) => (
            <article key={ev.id} className="card">
              <Link href={`/e/${ev.entity_slug}`} className={`card-media${ev.media_path ? '' : ' empty'}`} style={{ aspectRatio: '16 / 10' }}>
                {ev.media_path && <img src={mediaUrl(ev.media_path)!} alt={ev.entity_name ?? ''} />}
              </Link>
              <div className="card-body" style={{ gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
                    <Link href={`/e/${ev.entity_slug}`} style={{ color: 'var(--ink)' }}>{ev.entity_name}</Link>
                  </h2>
                  {(ev.decision_value ?? 0) >= 0.4 && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-ink)' }}>已上雷达</span>}
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>{ev.summary_zh}</p>
                <div className="card-foot">
                  <span className="mono" style={{ fontSize: 13 }}>
                    {typeof ev.payload.author === 'string' ? `${ev.payload.author} · ` : ''}{md(new Date(ev.occurred_at))}
                  </span>
                  <span className="path">{ev.capabilities[0]}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
