export const ATTR_ZH: Record<string, string> = {
  license_spdx: '许可',
  license_custom_terms: '许可条款',
  license_declared: '已声明许可',
  source_available: '源码公开',
  has_docs: '文档',
  docs_url: '文档地址',
  latest_version: '最新版本',
  renderer_observed: '渲染器',
  engine_version_observed: '引擎版本',
  initial_load_bytes: '首屏体积',
  runtime_requirements: '运行要求',
  input_modalities: '输入',
  output_formats: '输出格式',
  pricing_model: '定价',
  external_assets: '外部资产',
  web_readiness: 'Web 就绪',
  stars: 'Stars',
};

export const RELATION_ZH: Record<string, [out: string, inn: string]> = {
  built_with: ['使用', '被用于'],
  depends_on: ['依赖', '被依赖'],
  alternative_to: ['替代方案', '替代方案'],
  implements: ['实现', '被实现'],
  integrates_with: ['集成', '集成'],
  supersedes: ['取代', '被取代'],
  paper_of: ['论文', '论文'],
  code_of: ['代码', '代码'],
  weights_of: ['权重', '权重'],
  fork_of: ['分叉自', '被分叉'],
  made_by: ['作者', '作品'],
};

export const TYPE_ZH: Record<string, string> = {
  library: '库', engine: '引擎', tool: '工具', model: '模型', paper: '论文', demo: '演示',
  game: '游戏', technique: '技术', service: '服务', dataset: '数据集',
};

export function factValue(attr: string, v: unknown): string {
  if (typeof v === 'boolean') {
    if (attr === 'has_docs') return v ? '有' : '无';
    if (attr === 'external_assets') return v ? '有' : '无';
    return v ? '是' : '否';
  }
  if (Array.isArray(v)) return v.join(', ');
  if (attr === 'renderer_observed' && typeof v === 'string') return v === 'webgpu' ? 'WebGPU' : v === 'webgl2' ? 'WebGL2' : v;
  return String(v);
}

const pad = (n: number) => String(n).padStart(2, '0');
export const md = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Radar weeks run Saturday → Friday (UTC), matching the weekly issue. */
export function weekContaining(d: Date): { from: Date; to: Date } {
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const back = (day + 1) % 7;
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return { from, to: new Date(from.getTime() + 7 * 86400_000) };
}

/** The most recent fully finished week: the default radar issue. */
export function lastCompleteWeek(now = new Date()): { from: Date; to: Date } {
  const cur = weekContaining(now);
  return { from: new Date(cur.from.getTime() - 7 * 86400_000), to: cur.from };
}

export function weekTitle(from: Date): string {
  const end = new Date(from.getTime() + 6 * 86400_000);
  const sameMonth = from.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${from.getUTCMonth() + 1} 月 ${from.getUTCDate()}–${end.getUTCDate()} 日`
    : `${from.getUTCMonth() + 1} 月 ${from.getUTCDate()} 日 – ${end.getUTCMonth() + 1} 月 ${end.getUTCDate()} 日`;
}

export const mediaUrl = (path: string | null) => (path ? `/${path}` : null);

/** FNV-1a: stable pseudo-random placement on the domain map. */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
