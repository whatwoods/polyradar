// Signal triage (PLAN §4.2 相关度分类, §3.6 价值评分): cheap rules first, then
// one LLM call per surviving post. The model only judges; everything it
// returns is checked against the signal before anything is written.
import { z } from 'zod';
import { db } from '@polyradar/db';
import { normalizeUrl } from '@polyradar/db/keys';
import { complete } from '@polyradar/llm';
import { promote } from './promote.ts';

/** Below this rule score a post never reaches the model. */
const RULE_GATE = 0.25;
const CONCURRENCY = 6;

/** Sources whose items are the subject (a paper, a model), not a post about one. */
export const SELF_SUBJECT = new Set(['arxiv', 'hf_papers', 'hf_models']);

// Research items are judged from a web developer's seat: code alone does not
// make a paper usable, and a benchmark for video world models reaches no one
// building for the browser yet. Kept out of the system prompt so post verdicts stay cached.
const PAPER_SCORING = `Scoring note for papers and models: usable at most 0.4 unless there is a browser demo, a web-ready output (glTF/GLB, splats a web viewer can load) or a package developers can call today; reach at most 0.3 unless it directly changes how web 3D, 3D assets or games get made; benchmarks and evaluations of models are evidence for model choice, not usable tools.`;

export const KINDS = ['demo', 'game', 'library', 'tool', 'model', 'paper', 'tutorial', 'article', 'question', 'job', 'news', 'other'] as const;

// Hosts that can be where a post lives or a video of the thing, but never the thing itself.
const NOT_A_SUBJECT = /(^|\.)(discourse\.threejs\.org|reddit\.com|redd\.it|news\.ycombinator\.com|youtube\.com|youtu\.be|twitch\.tv|x\.com|twitter\.com|imgur\.com|vimeo\.com|discord\.gg|discord\.com)$/;

export interface Context {
  capabilities: { id: number; slug: string; en: string; zh: string }[];
  /** Every tool-like entity, for matching names in promote. */
  known: { id: number; name: string; aliases: string[] }[];
  /** Curated names for the prompt: stable, so the LLM cache survives new auto entities. */
  vocabulary: string[];
}

export async function loadContext(): Promise<Context> {
  const pool = db();
  const [caps, known] = await Promise.all([
    pool.query<{ id: number; slug: string; en: string; zh: string }>('select id, slug, name_en as en, name_zh as zh from capability order by slug'),
    pool.query<{ id: number; name: string; aliases: string[]; curated: boolean }>(
      `select id, name, aliases, curated from entity where type in ('library','engine','tool','service','model') and status <> 'archived' order by importance desc`),
  ]);
  return {
    capabilities: caps.rows,
    known: known.rows,
    vocabulary: known.rows.filter((k) => k.curated).map((k) => k.name).sort(),
  };
}

function schema(ctx: Context) {
  const score = z.number().min(0).max(1);
  return z.object({
    in_scope: z.boolean(),
    kind: z.enum(KINDS),
    is_author: z.boolean(),
    subject_url: z.string().nullable(),
    name: z.string().nullable(),
    capabilities: z.array(z.enum(ctx.capabilities.map((c) => c.slug) as [string, ...string[]])),
    built_with: z.array(z.string()),
    title_zh: z.string(),
    summary_zh: z.string(),
    summary_en: z.string(),
    decision: z.object({ usable: score, transferable: score, evidence: score, novelty: score, reach: score }),
    showcase: z.object({ visual: score, interactive: score, available: score }),
    insight: z.object({ claim_en: z.string(), claim_zh: z.string(), quote: z.string() }).nullable(),
  });
}
export type Triage = z.infer<ReturnType<typeof schema>>;

function systemPrompt(ctx: Context): string {
  return `You triage items for Polyradar, a verifiable index of real-time web 3D (three.js, WebGPU, WebGL, React Three Fiber, Babylon.js, PlayCanvas), AI 3D/texture/animation asset generation, procedural generation and AI-assisted game creation. Readers are developers and coding agents choosing tools and techniques.

Judge only from the item. Never fill in facts the item does not state.

in_scope: about building or running 3D/graphics/games on the web, WebGPU/WebGL platform and compute news, or AI tools that produce assets for them. Job ads, hiring, generic AI news, non-3D web apps and pure questions without a project are out of scope.
kind: what the item mainly is. "demo" = something you can open and run in a browser; "game" = a playable game; a help request is "question" even if it shows a project.
is_author: the poster made the thing being presented.
subject_url: the URL of the presented thing itself, copied exactly from the item's links. When there is both a live page and a repo, give the live page. null when there is none (video only, no public link) or when it is a discussion.
name: the project's name as written, or null.
capabilities: 1–3 of the most specific nodes that are central to the item. Never a parent when a child fits. Nodes:
${ctx.capabilities.map((c) => `- ${c.slug}: ${c.en}`).join('\n')}
built_with: libraries, engines and tools the item says it uses. Prefer these spellings when they match: ${ctx.vocabulary.join(', ')}.
title_zh: natural Chinese title, at most 30 characters, keep product names as written. summary_zh: one factual Chinese sentence, at most 80 characters, no praise. summary_en: the same in English.

decision (0–1 each), "would a developer or agent change their code or tool choice after reading this?". Be strict; most showcase posts land between 0.1 and 0.35 overall, and above 0.6 is reserved for items that change how many developers build things.
- usable: something others can adopt now. 0.8+ only for public code or a package with a clear license that others can reuse (library, tool, open source). A demo you can only play: at most 0.3.
- transferable: 0.8+ only when the post explains a non-obvious technique in enough detail to reimplement it (architecture, parameters, trade-offs, measured effects). A feature list or tech stack: at most 0.3.
- evidence: 0.7+ for a shipped, public product that names the third-party tools or AI models it was made with (a real usage record), for measured numbers, or for confirming/refuting a claim about an API. Otherwise at most 0.2.
- novelty: common things (instancing, procedural cities, product configurators, portfolios, particle effects, simple browser games) at most 0.3.
- reach: a personal or niche project at most 0.2; something affecting users of a core library or widely used tool 0.6+.
showcase (0–1 each), for a human gallery: visual (how striking it is likely to look), interactive, available (a link one can open right now).
insight: one reusable engineering lesson the author states explicitly, with a verbatim quote (copied exactly, at most 300 characters) that supports it; null if none.`;
}

function userPrompt(s: SignalForTriage): string {
  // The forum post's own URL is not one of its links.
  const links = s.urls.filter((u) => u !== s.post_url || s.source_kind !== 'discourse').slice(0, 12);
  return [
    `source: ${s.source_kind}${s.category ? ` / ${s.category}` : ''}${SELF_SUBJECT.has(s.source_kind) ? ' (the item is the paper or model itself)' : ''}`,
    `title: ${s.title}`,
    s.author ? `author: ${s.author}` : null,
    `links:\n${links.map((u) => `- ${u}`).join('\n') || '- (none)'}`,
    `text:\n${s.text.slice(0, 3500)}`,
    SELF_SUBJECT.has(s.source_kind) ? PAPER_SCORING : null,
  ].filter(Boolean).join('\n');
}

export interface SignalForTriage {
  id: string; raw_item_id: string; title: string; text: string; urls: string[]; relevance: number; entity_id: number | null;
  source_kind: string; category: string | null; author: string | null; published_at: Date; post_url: string | null;
  thread_url: string | null; image_url: string | null;
}

/** Subject URL only counts if it is one of the item's own links and not a forum/video host. */
export function checkSubject(subject: string | null, urls: string[]): string | null {
  if (!subject) return null;
  const n = normalizeUrl(subject);
  if (!n || NOT_A_SUBJECT.test(new URL(n).hostname)) return null;
  const own = urls.find((u) => normalizeUrl(u) === n);
  return own ?? null;
}

/** Keep the most specific nodes: drop any node whose descendant was also chosen. */
export function leafCapabilities(slugs: string[]): string[] {
  const set = [...new Set(slugs)];
  return set.filter((s) => !set.some((o) => o !== s && o.startsWith(`${s}/`))).slice(0, 3);
}

// PLAN §3.6 weights.
export const decisionValue = (d: Triage['decision']) =>
  Math.round((0.25 * d.usable + 0.25 * d.transferable + 0.2 * d.evidence + 0.15 * d.novelty + 0.15 * d.reach) * 100) / 100;
export const showcaseValue = (s: Triage['showcase']) => Math.round(((s.visual + s.interactive + s.available) / 3) * 100) / 100;

export async function loadSignals(ids: number[]): Promise<SignalForTriage[]> {
  const { rows } = await db().query<SignalForTriage>(
    `select g.id, g.raw_item_id, g.title, coalesce(g.text, '') as text, g.urls, coalesce(g.relevance, 0) as relevance, g.entity_id,
            s.kind as source_kind, r.payload->>'category' as category,
            coalesce(r.payload->>'name', r.payload->>'username', r.payload->>'author', r.payload->'authors'->>0, r.payload->>'did') as author,
            coalesce(r.published_at, r.fetched_at) as published_at, r.url as post_url,
            r.payload->>'topic_url' as thread_url, r.payload->>'image_url' as image_url
     from signal g join raw_item r on r.id = g.raw_item_id join source s on s.id = r.source_id
     where g.id = any($1) and g.kind in ('post', 'paper', 'model_upload') order by g.id`, [ids]);
  return rows;
}

export interface TriageStats { gated: number; judged: number; in_scope: number; created: number; attached: number; events: number; facts: number; failed: number }

export async function triage(ids: number[], log: (l: string) => void = console.log): Promise<TriageStats> {
  const stats: TriageStats = { gated: 0, judged: 0, in_scope: 0, created: 0, attached: 0, events: 0, facts: 0, failed: 0 };
  if (!ids.length) return stats;
  const ctx = await loadContext();
  const rows = await loadSignals(ids);

  const queue = [...rows];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        await triageOne(ctx, s, stats);
      } catch (err) {
        stats.failed++;
        log(`triage signal ${s.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return stats;
}

export interface Judgement { t: Triage; subject: string | null; caps: string[]; decision: number; showcase: number | null }

/** The LLM verdict plus the checks applied to it; no writes. Also used by the eval. */
export async function judge(ctx: Context, s: SignalForTriage): Promise<Judgement> {
  const t = await complete({ purpose: 'triage-v4', tier: 'fast', system: systemPrompt(ctx), user: userPrompt(s), schema: schema(ctx) });
  // Papers and model pages are the thing itself, whoever "posted" them.
  const subject = SELF_SUBJECT.has(s.source_kind) ? s.post_url : checkSubject(t.subject_url, s.urls);
  const caps = leafCapabilities(t.capabilities);
  const decision = t.in_scope ? decisionValue(t.decision) : 0;
  // Tools with their own page (benchmarks, viewers) belong in the gallery too; repos do not.
  const viewable = t.kind === 'demo' || t.kind === 'game' || (t.kind === 'tool' && subject != null && !/github\.com|npmjs\.com/.test(subject));
  const showcase = t.in_scope && viewable && subject ? showcaseValue(t.showcase) : null;
  return { t, subject, caps, decision, showcase };
}

async function triageOne(ctx: Context, s: SignalForTriage, stats: TriageStats): Promise<void> {
  if (s.relevance < RULE_GATE && s.entity_id == null) {
    await db().query(`update signal set triage = '{"gate":"rule"}', relevance = least(relevance, 0.1), triaged_at = now() where id = $1`, [s.id]);
    stats.gated++;
    return;
  }
  const { t, subject, caps, decision, showcase } = await judge(ctx, s);
  stats.judged++;
  const capIds = ctx.capabilities.filter((c) => caps.includes(c.slug)).map((c) => c.id);

  await db().query(
    `update signal set triage = $2, triaged_at = now(), capability_ids = $3,
       relevance = case when $4 then greatest(0.6, 0.6 + 0.4 * $5) else 0.1 end
     where id = $1`,
    [s.id, JSON.stringify({ ...t, subject_url: subject, capabilities: caps, decision_value: decision, showcase_value: showcase }), capIds, t.in_scope, decision],
  );
  if (!t.in_scope) return;
  stats.in_scope++;
  await promote(ctx, s, { ...t, subject_url: subject, capabilities: caps }, { decision, showcase }, stats);
}
