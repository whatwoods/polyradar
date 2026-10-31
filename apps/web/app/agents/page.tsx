import { headers } from 'next/headers';

export const metadata = { title: 'Agent 接入' };

const TOOLS = [
  ['search', '按能力、类型、关键词找实体'],
  ['get', '实体全部事实、证据、洞见与时间线'],
  ['compare', '2–5 个实体逐项对比'],
  ['whats_new', '某日期以来的变化，按决策价值排序'],
  ['check_api', '某个 three.js 版本里 API 是否有效'],
  ['get_demo', '演示地址、运行要求与检查结果'],
  ['report', '报告错误或过期的事实'],
];

export default async function AgentsPage() {
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3100'}`;
  return (
    <>
      <section className="section" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 className="h1">Agent 接入</h1>
        <div className="cmd">
          <code>claude mcp add --transport http polyradar {origin}/mcp</code>
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section">
        <div className="section-head">
          <h2 className="h2">工具</h2>
          <a className="more" href="/llms.txt">LLMS.TXT →</a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
          {TOOLS.map(([name, desc]) => (
            <div key={name} style={{ padding: '18px 20px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' }}>
              <div className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{name}</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-flush">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <pre className="code light" style={{ borderRadius: 0, border: 0 }}>{`check_api({
  symbol: "renderer.outputEncoding",
  version: "r186"
})`}</pre>
          <pre className="code" style={{ borderRadius: 0 }}>{`{
  "symbol": "WebGLRenderer.outputEncoding",
  "exists": false,
  "deprecated_in": "r152",
  "removed_in": "r162",
  "replacement": "Use WebGLRenderer.outputColorSpace …"
}`}</pre>
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 40 }}>
        <div>
          <h2 className="h3" style={{ marginBottom: 16 }}>REST</h2>
          <div className="rows mono" style={{ fontSize: 14 }}>
            <a href="/v1/check_api?symbol=WebGLRenderer.outputEncoding&version=r160"><span>/v1/check_api</span></a>
            <a href="/v1/changes?package=three&version=r187"><span>/v1/changes</span></a>
            <a href="/v1/search?q=particles"><span>/v1/search</span></a>
            <a href="/v1/whats_new?since=2026-10-24"><span>/v1/whats_new</span></a>
          </div>
        </div>
        <div>
          <h2 className="h3" style={{ marginBottom: 16 }}>纯文本</h2>
          <div className="rows mono" style={{ fontSize: 14 }}>
            <a href="/llms.txt"><span>/llms.txt</span></a>
            <a href="/e/meep.md"><span>/e/{'{slug}'}.md</span></a>
            <a href="/feed.json"><span>/feed.json</span></a>
          </div>
        </div>
      </section>
    </>
  );
}
