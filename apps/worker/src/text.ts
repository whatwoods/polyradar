// Plain-code text helpers for normalization (PLAN §4.2: no LLM at this stage).

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<aside class="onebox[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Absolute http(s) links in an HTML fragment, in document order, without duplicates. */
export function hrefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const h = decodeEntities(m[1]!);
    if (/^https?:\/\//i.test(h)) out.add(h);
  }
  return [...out];
}

export function detectLang(s: string): string {
  const sample = s.slice(0, 2000);
  const kana = (sample.match(/[぀-ヿ]/g) ?? []).length;
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  const letters = (sample.match(/[a-z]/gi) ?? []).length;
  if (kana > 10) return 'ja';
  if (han > 10 && han * 2 > letters / 4) return 'zh';
  return 'en';
}

// Rule-based relevance v0. Week 3 replaces the middle band with a classifier;
// the rules stay as the cheap first filter (PLAN §4.2).
const STRONG = [/three\.?js/i, /webgpu/i, /\bwgsl\b/i, /\btsl\b/, /react[- ]three[- ]fiber|\br3f\b/i, /gaussian splat/i, /\bwebgl ?2?\b/i, /babylon\.?js/i, /playcanvas/i, /\bwebxr\b/i];
const WEAK = [/\b3d\b/i, /shader/i, /procedural/i, /\bglb\b|\bgltf\b/i, /(text|image)[- ]to[- ]3d/i, /world model/i, /game engine/i, /voxel/i, /ray ?march/i, /\bsplat/i, /\bmesh\b/i];

export function keywordRelevance(s: string): number {
  const strong = STRONG.filter((r) => r.test(s)).length;
  const weak = WEAK.filter((r) => r.test(s)).length;
  return Math.min(1, strong * 0.35 + weak * 0.12);
}

// Papers are mostly scored by the model; this only keeps obviously off-topic
// ones (LLM agents, finance, robotics-only) from reaching it.
const PAPER_TERMS = /\b3d\b|\b4d\b|gaussian|splat|nerf|\bmesh|world (model|generation)|\bgames?\b|procedural|texture|avatar|\brig(ging)?\b|animation|scene (generation|reconstruction|synthesis)|voxel|point cloud|render/i;

export function paperRelevance(s: string): number {
  return Math.max(keywordRelevance(s), PAPER_TERMS.test(s) ? 0.3 : 0);
}
