import Link from 'next/link';
import { recentSignals, sourceHealth, type SourceStatus } from '@polyradar/db/queries/sources';
import { ago, duration, md, SOURCE_KIND_ZH } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: '来源' };

const STATUS: Record<SourceStatus, { zh: string; color: string; square?: boolean }> = {
  ok: { zh: '正常', color: 'var(--blue)' },
  stale: { zh: '停更', color: 'var(--warn)' },
  error: { zh: '出错', color: 'var(--accent)', square: true },
  pending: { zh: '未运行', color: 'var(--line-strong)' },
  disabled: { zh: '已停用', color: 'var(--line-strong)' },
};

const NUM = { textAlign: 'right', paddingRight: 28 } as const;

type Search = { source?: string; all?: string };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { source, all } = await searchParams;
  const [sources, signals] = await Promise.all([
    sourceHealth(),
    recentSignals({ source: source ?? null, minRelevance: all ? 0 : 0.5, limit: 60 }),
  ]);
  const healthy = sources.filter((s) => s.status === 'ok').length;
  const qs = (next: Search) => {
    const p = new URLSearchParams();
    if (next.source) p.set('source', next.source);
    if (next.all) p.set('all', '1');
    const s = p.toString();
    return s ? `/sources?${s}` : '/sources';
  };

  return (
    <>
      <section className="section" style={{ paddingBottom: 32 }}>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h1 className="h1">来源</h1>
          <span className="btn mono" style={{ cursor: 'default' }}>{healthy} / {sources.length} 正常</span>
        </div>
      </section>

      <section className="section-flush">
        <div style={{ overflowX: 'auto' }}>
          <table className="facts" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>来源</th><th>状态</th><th>类型</th><th>频率</th><th>上次成功</th>
                <th style={NUM}>24 小时新增</th><th style={NUM}>时效 P90</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const st = STATUS[s.status];
                const note = s.status === 'error' ? s.last_error : s.warnings.length ? s.warnings.join('；') : null;
                return (
                  <tr key={s.slug}>
                    <td><Link className="mono" href={qs({ source: s.slug, all })}>{s.slug}</Link></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span className="dot" style={{ background: st.color, borderRadius: st.square ? 2 : 4 }} />{st.zh}
                      </span>
                      {note && <div className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{note}</div>}
                    </td>
                    <td>{SOURCE_KIND_ZH[s.kind] ?? s.kind} <span className="mono muted" style={{ fontSize: 12 }}>{s.tier}</span></td>
                    <td className="mono">{duration(s.interval_sec)}</td>
                    <td>{ago(s.last_success_at)}</td>
                    <td className="mono" style={NUM}>{s.items_24h}</td>
                    <td className="mono" style={NUM}>{duration(s.lag_p90_sec)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section">
        <div className="section-head" style={{ marginBottom: 20 }}>
          <h2 className="h3">信号</h2>
          <span className="pills">
            <Link className="pill" href={qs({ source })} aria-current={!all ? 'true' : undefined}>相关</Link>
            <Link className="pill" href={qs({ source, all: '1' })} aria-current={all ? 'true' : undefined}>全部</Link>
          </span>
        </div>
        <nav aria-label="按来源" className="pills" style={{ marginBottom: 20 }}>
          <Link className="pill" href={qs({ all })} aria-current={!source ? 'true' : undefined}>全部来源</Link>
          {sources.map((s) => (
            <Link key={s.slug} className="pill mono" style={{ fontSize: 13 }} href={qs({ source: s.slug, all })}
              aria-current={source === s.slug ? 'true' : undefined}>{s.slug}</Link>
          ))}
        </nav>
        {signals.length ? (
          <div className="rows">
            {signals.map((g) => (
              <div key={g.id} style={{ alignItems: 'baseline' }}>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {g.url ? <a href={g.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{g.title}</a> : <span>{g.title}</span>}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {g.source_slug}
                    {g.entity_slug && <> · <Link href={`/e/${g.entity_slug}`}>{g.entity_name}</Link></>}
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap', display: 'flex', gap: 14 }}>
                  <span title="相关度" style={{ color: (g.relevance ?? 0) >= 0.7 ? 'var(--accent-ink)' : 'var(--muted)' }}>{(g.relevance ?? 0).toFixed(2)}</span>
                  <span className="muted">{g.published_at ? md(new Date(g.published_at)) : ''}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>没有信号。</p>
        )}
      </section>
    </>
  );
}
