import Link from 'next/link';
import { capabilityTree, logQuery, searchEntities } from '@polyradar/db/queries/entities';
import { TYPE_ZH } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: '浏览' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; cap?: string }> }) {
  const { q = '', cap } = await searchParams;
  const [results, caps] = await Promise.all([searchEntities(q, { capability: cap, limit: 50 }), capabilityTree()]);
  if (q) await logQuery('web', q, { cap }, results.length);
  const tops = caps.filter((c) => !c.slug.includes('/'));
  const children = cap ? caps.filter((c) => c.slug.startsWith(`${cap.split('/')[0]}/`) && c.entity_count > 0) : [];

  return (
    <>
      <section className="section" style={{ paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 className="h1">{q ? `“${q}”` : '浏览'}</h1>
        <form className="pills" style={{ gap: 8 }}>
          <label className="sr-only" htmlFor="sq">搜索</label>
          <input id="sq" name="q" className="input" defaultValue={q} placeholder="实体、技术、能力" style={{ flex: '1 1 260px', minWidth: 0 }} />
          {cap && <input type="hidden" name="cap" value={cap} />}
          <button className="btn btn-dark" type="submit">搜索</button>
        </form>
        <nav aria-label="能力" className="pills">
          <Link className="pill" href={q ? `/search?q=${encodeURIComponent(q)}` : '/search'} aria-current={!cap ? 'true' : undefined}>全部</Link>
          {tops.map((c) => (
            <Link key={c.slug} className="pill" href={`/search?cap=${c.slug}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              aria-current={cap?.split('/')[0] === c.slug ? 'true' : undefined}>
              {c.name_zh}<span className="mono muted" style={{ fontSize: 12 }}>{c.entity_count}</span>
            </Link>
          ))}
        </nav>
        {children.length > 0 && (
          <nav aria-label="子能力" className="pills">
            {children.map((c) => (
              <Link key={c.slug} className="pill" href={`/search?cap=${c.slug}`} aria-current={cap === c.slug ? 'true' : undefined} style={{ height: 32, fontSize: 13 }}>
                {c.name_zh}
              </Link>
            ))}
          </nav>
        )}
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section">
        {results.length ? (
          <div className="rows">
            {results.map((e) => (
              <Link key={e.slug} href={`/e/${e.slug}`} style={{ alignItems: 'baseline' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{e.name}</span>
                  <span className="muted" style={{ fontSize: 14 }}>{e.summary_zh}</span>
                </span>
                <span className="pills" style={{ flexShrink: 0 }}>
                  <span className="tag">{TYPE_ZH[e.type] ?? e.type}</span>
                  {e.evidence_level && <span className="tag mono">{e.evidence_level}</span>}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>没有匹配的实体。</p>
        )}
      </section>
    </>
  );
}
