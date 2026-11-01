import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEntity } from '@polyradar/db/queries/entities';
import { ATTR_ZH, RELATION_ZH, TYPE_ZH, factValue, mediaUrl, ymd, METHOD_ZH } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const e = await getEntity((await params).slug);
  return e ? { title: e.name, description: e.summary_zh ?? undefined, alternates: { types: { 'text/markdown': `/e/${e.slug}.md` } } } : {};
}

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const e = await getEntity((await params).slug);
  if (!e) notFound();

  const open = e.facts.filter((f) => !f.valid_to);
  const closedByAttr = new Map<string, typeof e.facts>();
  for (const f of e.facts.filter((f) => f.valid_to)) closedByAttr.set(f.attribute, [...(closedByAttr.get(f.attribute) ?? []), f]);
  const image = e.media.find((m) => m.kind === 'image');
  const demo = e.demos[0];
  const license = open.find((f) => f.attribute === 'license_spdx' || f.attribute === 'license_custom_terms');

  return (
    <>
      <section className="section" style={{ paddingBottom: 36, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="path" style={{ fontSize: 13 }}>{e.capabilities.map((c) => c.slug).join(' · ')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
          <h1 className="h1-xl">{e.name}</h1>
          <div className="pills">
            <a className="btn btn-dark" href={`/e/${e.slug}.md`}>给 Agent 的 Markdown</a>
            {demo && <a className="btn" href={demo.url} target="_blank" rel="noreferrer">打开演示</a>}
          </div>
        </div>
        {e.summary_zh && <p className="lede">{e.summary_zh}</p>}
        <div className="pills">
          <span className="tag">{TYPE_ZH[e.type] ?? e.type}</span>
          {license && <span className="tag">{factValue(license.attribute, license.value)}</span>}
          {e.evidence_level && <span className="tag mono">{e.evidence_level}</span>}
          {e.status === 'watch' && <span className="tag">观察中</span>}
        </div>
      </section>

      {image && (
        <section className="section-flush">
          <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <div className="card-media" style={{ flex: '3 1 520px', minHeight: 320, aspectRatio: 'auto' }}>
              <img src={mediaUrl(image.path)!} alt={e.name} style={{ position: 'absolute', inset: 0 }} />
            </div>
            <div style={{ flex: '2 1 300px', minWidth: 0, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>演示检查</h2>
              {demo ? (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', fontSize: 14 }}>
                  <dt className="muted">地址</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}><a href={demo.url} target="_blank" rel="noreferrer">{demo.url.replace(/^https?:\/\//, '')}</a></dd>
                  <dt className="muted">需要</dt><dd className="mono" style={{ margin: 0 }}>{demo.requires.join(', ') || '—'}</dd>
                  <dt className="muted">检查</dt><dd style={{ margin: 0 }}>{demo.last_checked_at ? ymd(new Date(demo.last_checked_at)) : '尚未自动检查'}</dd>
                </dl>
              ) : (
                <p className="muted" style={{ margin: 0 }}>没有公开演示地址。</p>
              )}
              {image.attribution && <p className="muted" style={{ margin: 'auto 0 0', fontSize: 13 }}>图片：{image.attribution}</p>}
            </div>
          </div>
        </section>
      )}

      <div className="hatch" aria-hidden="true" />

      <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 40 }}>
        <div>
          <h2 className="h3" style={{ marginBottom: 18 }}>事实</h2>
          {open.length ? (
            <table className="facts">
              <thead><tr><th scope="col">属性</th><th scope="col">值</th><th scope="col">来源</th></tr></thead>
              <tbody>
                {open.map((f) => {
                  const before = closedByAttr.get(f.attribute)?.[0];
                  return (
                    <tr key={f.attribute}>
                      <td className="muted">{ATTR_ZH[f.attribute] ?? f.attribute}</td>
                      <td>
                        {before && <><span className="struck">{factValue(before.attribute, before.value)}</span> → </>}
                        {factValue(f.attribute, f.value)}
                        {before && <span className="changed">{ymd(new Date(f.valid_from))} 变化</span>}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {f.evidence_url
                          ? <a href={f.evidence_url} target="_blank" rel="noreferrer" title={f.evidence_quote ?? undefined}>{METHOD_ZH[f.method] ?? f.method}</a>
                          : METHOD_ZH[f.method] ?? f.method}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ margin: 0 }}>还没有结构化事实。</p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {e.insights.length > 0 && (
            <div>
              <h2 className="h3" style={{ marginBottom: 18 }}>洞见</h2>
              {e.insights.map((i) => (
                <div key={i.claim_en} className="insight" style={{ background: 'var(--surface)', border: '1px solid var(--line)', padding: '16px 18px', marginBottom: 10 }}>
                  <div className="insight-head">
                    <span>{i.author ?? '社区'}</span>
                    <span>{i.evidence_level} · {i.evidence_url ? <a href={i.evidence_url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>原帖</a> : '原帖'}</span>
                  </div>
                  <p>{i.claim_zh ?? i.claim_en}</p>
                </div>
              ))}
            </div>
          )}
          {e.relations.length > 0 && (
            <div>
              <h2 className="h3" style={{ marginBottom: 18 }}>关系</h2>
              <div className="rows">
                {e.relations.map((r) => (
                  <Link key={`${r.direction}${r.type}${r.slug}`} href={`/e/${r.slug}`}>
                    <span className="muted">{RELATION_ZH[r.type]?.[r.direction === 'out' ? 0 : 1] ?? r.type}</span>
                    <span>{r.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 40 }}>
        <div>
          <h2 className="h3" style={{ marginBottom: 18 }}>时间线</h2>
          {e.events.length ? (
            <ol className="timeline">
              {e.events.map((ev) => (
                <li key={ev.id} className={ev.type === 'fact_changed' ? 'accent' : undefined}>
                  <div className="mono muted" style={{ fontSize: 13 }}>{ymd(new Date(ev.occurred_at))}</div>
                  <div>{ev.type === 'fact_changed' ? factChange(ev.payload) : (ev.title_zh ?? ev.title)}</div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted" style={{ margin: 0 }}>暂无事件。</p>
          )}
        </div>
        <div>
          <h2 className="h3" style={{ marginBottom: 18 }}>给 Agent</h2>
          <pre className="code">{`get({ slug: "${e.slug}" })\nGET /v1/entities/${e.slug}\nGET /e/${e.slug}.md`}</pre>
        </div>
      </section>
    </>
  );
}

function factChange(p: Record<string, unknown>): string {
  const attr = String(p.attribute);
  return `${ATTR_ZH[attr] ?? attr}：${factValue(attr, p.before)} → ${factValue(attr, p.after)}`;
}
