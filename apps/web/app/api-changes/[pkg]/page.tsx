import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiVersions, changesIn, checkApi, lifelines, resolveSymbols } from '@polyradar/db/queries/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API 变更' };

const DEFAULT_SYMBOLS = [
  'WebGLRenderer.outputEncoding',
  'WebGLRenderer.outputColorSpace',
  'WebGLRenderer.useLegacyLights',
  'WebGLRenderer.compileAsync',
  'Renderer.compileAsync',
  'Object3D.dispose',
];

type Search = { symbol?: string; version?: string; v?: string };

export default async function ApiChangesPage({ params, searchParams }: { params: Promise<{ pkg: string }>; searchParams: Promise<Search> }) {
  const { pkg } = await params;
  const { symbol, version, v } = await searchParams;
  const versions = await apiVersions(pkg);
  if (!versions.length) notFound();

  const first = versions[0]!.seq;
  const last = versions.at(-1)!;
  const span = last.seq - first || 1;
  const pos = (seq: number) => ((seq - first) / span) * 100;

  const check = symbol ? await checkApi(pkg, symbol, version || null) : null;
  const picked = check?.matches[0]?.symbol ?? null;
  const symbols = [...new Set([...(picked ? [picked] : []), ...(symbol ? await resolveSymbols(pkg, symbol, 3) : []), ...DEFAULT_SYMBOLS])];
  const lines = await lifelines(pkg, symbols);

  const listVersion = v && versions.some((x) => x.version === v) ? v : last.version;
  const changes = await changesIn(pkg, listVersion);
  const ticks = [first, first + Math.round(span / 3), first + Math.round((2 * span) / 3), last.seq];

  return (
    <>
      <section className="section" style={{ paddingBottom: 32 }}>
        <div className="section-head" style={{ marginBottom: 20 }}>
          <h1 className="h1">API 变更</h1>
          <span className="pills">
            <span className="btn mono" style={{ cursor: 'default' }}>{pkg}</span>
            <span className="btn mono" style={{ cursor: 'default' }}>{versions[0]!.version} → {last.version}</span>
          </span>
        </div>
        <div className="pills" aria-hidden="true">
          <span className="pill"><span className="dot" style={{ background: 'var(--blue)' }} />新增</span>
          <span className="pill"><span className="dot" style={{ background: 'var(--warn)' }} />废弃</span>
          <span className="pill"><span className="dot" style={{ background: 'var(--accent)', borderRadius: 2 }} />删除</span>
        </div>
      </section>

      <section className="section-flush">
        <div className="lifelines">
          <div className="lifeline" style={{ paddingTop: 0 }}>
            <span />
            <div className="axis">
              {ticks.map((t, i) => (
                <span key={t} style={{ position: 'absolute', left: `${pos(t)}%`, transform: i === ticks.length - 1 ? 'translateX(-100%)' : i ? 'translateX(-50%)' : undefined }}>
                  r{t}
                </span>
              ))}
            </div>
          </div>
          {lines.map((l) => {
            const start = l.added ?? first;
            const solidEnd = l.deprecated ?? l.removed ?? last.seq;
            const end = l.removed ?? last.seq;
            const visible = l.added || l.deprecated || l.removed;
            return (
              <Link key={l.symbol} href={`?symbol=${encodeURIComponent(l.symbol)}${version ? `&version=${version}` : ''}`}
                className={`lifeline${l.symbol === picked ? ' selected' : ''}`}>
                <span className="lifeline-name">{l.symbol}</span>
                <div className="lifeline-track">
                  {visible || start === first ? (
                    <>
                      <span style={{ left: `${pos(start)}%`, width: `${pos(solidEnd) - pos(start)}%`, top: 7, height: 2, background: 'var(--ink)' }} />
                      {l.deprecated != null && (
                        <span style={{ left: `${pos(l.deprecated)}%`, width: `${pos(end) - pos(l.deprecated)}%`, top: 7, height: 2,
                          background: 'repeating-linear-gradient(90deg, var(--warn) 0 4px, transparent 4px 7px)' }} />
                      )}
                      {l.added != null && <Marker at={pos(l.added)} color="var(--blue)" label={`r${l.added} 新增`} />}
                      {l.deprecated != null && <Marker at={pos(l.deprecated)} color="var(--warn)" label={`r${l.deprecated} 废弃`} />}
                      {l.removed != null && <Marker at={pos(l.removed)} color="var(--accent)" square label={`r${l.removed} 删除`} />}
                    </>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="hatch" aria-hidden="true" />

      <section className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 40 }}>
        <div>
          <h2 className="h3" style={{ marginBottom: 18 }}>该版本是否有效？</h2>
          <form className="pills" style={{ gap: 8 }}>
            <label className="sr-only" htmlFor="symbol">API 名称</label>
            <input id="symbol" name="symbol" className="input mono" defaultValue={symbol ?? 'renderer.outputEncoding'} style={{ flex: '1 1 220px', minWidth: 0 }} />
            <label className="sr-only" htmlFor="version">版本</label>
            <input id="version" name="version" className="input mono" defaultValue={version ?? last.version} style={{ width: 96 }} />
            <button type="submit" className="btn btn-dark">检查</button>
          </form>
          {check && check.matches.length === 0 && (
            <div className="verdict no"><strong>没有找到这个符号</strong><span>任何已收录版本中都不存在</span></div>
          )}
          {check?.matches.map((m) => (
            <div key={m.symbol} className={`verdict ${m.exists ? 'yes' : 'no'}`}>
              <strong className="mono">{m.symbol}</strong>
              <span>
                {m.exists
                  ? `${check.version} 中存在${m.inherited_from ? `（继承自 ${m.inherited_from}）` : ''}${m.deprecated ? '，已废弃' : ''}`
                  : m.removed_in ? `${check.version} 中不存在 · ${m.removed_in} 删除` : `${check.version} 中还不存在 · ${m.added_in} 起才有`}
              </span>
              {m.replacement && <span style={{ flexBasis: '100%', fontSize: 14 }}>{m.replacement}</span>}
            </div>
          ))}
        </div>
        <div>
          <h2 className="h3" style={{ marginBottom: 18 }}>{listVersion} 删除与废弃</h2>
          <div className="pills" style={{ marginBottom: 14 }}>
            {versions.slice(-6).map((x) => (
              <Link key={x.version} className="pill mono" href={`?v=${x.version}`} aria-current={x.version === listVersion ? 'true' : undefined}>{x.version}</Link>
            ))}
          </div>
          {changes.length ? (
            <div className="rows" style={{ fontSize: 14 }}>
              {changes.slice(0, 40).map((c) => (
                <Link key={c.kind + c.symbol} href={`?symbol=${encodeURIComponent(c.symbol)}&version=${listVersion}`}>
                  <span className="mono" style={{ overflowWrap: 'anywhere' }}>{c.symbol}</span>
                  <span style={{ color: c.kind === 'removed' ? 'var(--accent-ink)' : '#8A5A00', whiteSpace: 'nowrap' }}>{c.kind === 'removed' ? '删除' : '废弃'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>该版本没有删除或废弃的符号。</p>
          )}
          {changes.length > 40 && <p className="muted" style={{ fontSize: 13 }}>另有 {changes.length - 40} 条，见 <a href={`/v1/changes?package=${pkg}&version=${listVersion}`}>JSON</a>。</p>}
        </div>
      </section>
    </>
  );
}

function Marker({ at, color, label, square }: { at: number; color: string; label: string; square?: boolean }) {
  return (
    <span title={label} style={{ left: `${at}%`, top: 3, width: 10, height: 10, marginLeft: -5, borderRadius: square ? 2 : '50%', background: color }} />
  );
}
