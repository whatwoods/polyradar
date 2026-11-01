// Turns a triaged in-scope post into index data (PLAN §4.3 发布策略):
// attach it to the entity it is about, or create that entity when the post
// presents its own work behind a canonical key; then event, relations,
// evidence-backed facts and insight. Items without a key stay signals.
import { db, type PoolClient } from '@polyradar/db';
import { upsertEvidence } from '@polyradar/db/facts';
import { keysFromUrl, keyString } from '@polyradar/db/keys';
import { extractFacts, quoteIn } from './extract.ts';
import type { Context, SignalForTriage, Triage, TriageStats } from './triage.ts';

const PROMOTABLE = new Set(['demo', 'game', 'library', 'tool', 'model']);
const ENTITY_TYPE: Record<string, string> = { demo: 'demo', game: 'game', library: 'library', tool: 'tool', model: 'model' };
/** A post joins an existing event about the same thread within this window (PLAN §3.4 uses 48 h for same-type signals). */
const CLUSTER_DAYS = 14;

export function slugify(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/['\u2019]/g, '').replace(/[^\w\s-]/g, ' ').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
}

export async function promote(
  ctx: Context, s: SignalForTriage, t: Triage, scores: { decision: number; showcase: number | null }, stats: TriageStats,
): Promise<void> {
  const c = await db().connect();
  try {
    await c.query('begin');
    const r = await promoteIn(c, ctx, s, t, scores, stats);
    await c.query('commit');
    // Extraction is a separate LLM call; run it outside the transaction.
    if (r) stats.facts += await extractFacts(r.entityId, s, r.created);
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

async function promoteIn(
  c: PoolClient, ctx: Context, s: SignalForTriage, t: Triage, scores: { decision: number; showcase: number | null }, stats: TriageStats,
): Promise<{ entityId: number; created: boolean } | null> {
  let entityId = s.entity_id;
  if (entityId == null && t.subject_url) {
    const keys = keysFromUrl(t.subject_url).map(keyString);
    const hit = await c.query<{ entity_id: number }>(
      `select entity_id from entity_key where key_type || ':' || key = any($1) limit 1`, [keys]);
    entityId = hit.rows[0]?.entity_id ?? null;
  }

  if (entityId == null && t.name) {
    // Fuzzy fallback (PLAN §3.4 step 3): a different URL for a project we already track by name.
    const byName = await c.query<{ id: number }>(
      `select id from entity where lower(name) = lower($1) or lower($1) = any(select lower(a) from unnest(aliases) a)
       order by importance desc limit 1`, [t.name.trim()]);
    entityId = byName.rows[0]?.id ?? null;
  }

  let created = false;
  if (entityId == null) {
    if (!(PROMOTABLE.has(t.kind) && t.is_author && t.subject_url)) return null;
    // Unnamed projects are known by their address.
    t = { ...t, name: t.name ?? new URL(t.subject_url).hostname.replace(/^www\./, '') };
    entityId = await createEntity(c, ctx, s, t, scores.decision);
    created = true;
    stats.created++;
  } else {
    stats.attached++;
  }
  await c.query('update signal set entity_id = $2 where id = $1', [s.id, entityId]);

  if (created) await addBuiltWith(c, ctx, entityId, t.built_with, s.post_url);

  // Same thread, or the same entity's launch, already has an event: join it (PLAN §3.4).
  const threads = [s.thread_url, s.post_url, ...s.urls].filter(Boolean) as string[];
  const existing = await c.query<{ id: string }>(
    `select id from event
     where (source_url = any($1) or (entity_id = $3 and type in ('demo_published', 'new_entity')))
       and occurred_at > $2::timestamptz - interval '${CLUSTER_DAYS} days'
     order by occurred_at desc limit 1`, [threads, s.published_at, entityId]);
  let eventId = existing.rows[0]?.id ?? null;

  if (!eventId && (created || (t.is_author && PROMOTABLE.has(t.kind)))) {
    const type = t.kind === 'demo' || t.kind === 'game' ? 'demo_published' : 'new_entity';
    const ins = await c.query<{ id: string }>(
      `insert into event (entity_id, type, occurred_at, importance, decision_value, showcase_value, title, title_zh, summary_en, summary_zh, source_url, payload, cluster_key)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (cluster_key) do update set decision_value = excluded.decision_value, showcase_value = excluded.showcase_value,
         title_zh = excluded.title_zh, summary_zh = excluded.summary_zh
       returning id`,
      [entityId, type, s.published_at, scores.decision, scores.showcase, t.name ?? s.title, t.title_zh, t.summary_en, t.summary_zh,
       s.post_url, JSON.stringify({ author: s.author, signal_id: s.id }), `post:${s.post_url}`],
    );
    eventId = ins.rows[0]!.id;
    stats.events++;
  }
  if (eventId) {
    await c.query('update signal set event_id = $2 where id = $1', [s.id, eventId]);
    await c.query(
      `update event set (signal_count, source_diversity) = (
         select count(*), count(distinct r.source_id) from signal g join raw_item r on r.id = g.raw_item_id where g.event_id = $1)
       where id = $1`, [eventId]);
  }

  if (t.insight && quoteIn(t.insight.quote, `${s.title}\n${s.text}`) && s.post_url) {
    const evidenceId = await upsertEvidence(c, s.post_url, t.insight.quote);
    await c.query(
      `insert into insight (entity_ids, claim_en, claim_zh, author, evidence_id, evidence_level)
       select $1, $2, $3, $4, $5, 'E0' where not exists (select 1 from insight where evidence_id = $5)`,
      [[entityId], t.insight.claim_en, t.insight.claim_zh, s.author, evidenceId]);
  }
  await c.query('update entity set last_activity_at = greatest(last_activity_at, $2) where id = $1', [entityId, s.published_at]);
  return { entityId, created };
}

async function createEntity(c: PoolClient, ctx: Context, s: SignalForTriage, t: Triage, decision: number): Promise<number> {
  const base = slugify(t.name!) || slugify(new URL(t.subject_url!).hostname);
  let slug = base;
  for (let i = 2; (await c.query('select 1 from entity where slug = $1', [slug])).rowCount; i++) slug = `${base}-${i}`;

  const { rows } = await c.query<{ id: number }>(
    `insert into entity (slug, type, name, summary_en, summary_zh, status, evidence_level, importance, first_seen_at, last_activity_at)
     values ($1, $2, $3, $4, $5, 'active', 'E1', $6, $7, $7) returning id`,
    // E1: the post links a runnable demo or code (PLAN §3.3); E2 needs our own check.
    [slug, ENTITY_TYPE[t.kind], t.name, t.summary_en, t.summary_zh, decision, s.published_at],
  );
  const id = rows[0]!.id;
  for (const k of keysFromUrl(t.subject_url!)) {
    await c.query('insert into entity_key (entity_id, key_type, key) values ($1, $2, $3) on conflict do nothing', [id, k.type, k.key]);
  }
  const capIds = ctx.capabilities.filter((x) => t.capabilities.includes(x.slug)).map((x) => x.id);
  const evidenceId = s.post_url ? await upsertEvidence(c, s.post_url) : null;
  for (const capId of capIds) {
    await c.query(
      `insert into entity_capability (entity_id, capability_id, role, evidence_id) values ($1, $2, 'provides', $3) on conflict do nothing`,
      [id, capId, evidenceId]);
  }
  if (t.kind === 'demo' || t.kind === 'game') {
    // requires stays empty until a fact or the capture worker says otherwise
    await c.query('insert into demo (entity_id, url) values ($1, $2) on conflict (url) do nothing', [id, t.subject_url]);
  }
  if (s.image_url) {
    await c.query(
      `insert into media (entity_id, kind, origin, original_url, attribution) values ($1, 'image', 'third_party', $2, $3)`,
      [id, s.image_url, s.author]);
  }
  return id;
}

async function addBuiltWith(c: PoolClient, ctx: Context, entityId: number, names: string[], postUrl: string | null): Promise<void> {
  const norm = (x: string) => x.toLowerCase().replace(/[\s.\-_]/g, '');
  const evidenceId = postUrl ? await upsertEvidence(c, postUrl) : null;
  for (const name of names) {
    const n = norm(name);
    const hit = ctx.known.find((k) => norm(k.name) === n || k.aliases.some((a) => norm(a) === n));
    if (!hit || hit.id === entityId) continue;
    await c.query(
      `insert into relation (src_id, dst_id, type, evidence_id, confidence) values ($1, $2, 'built_with', $3, 0.7)
       on conflict (src_id, dst_id, type) do nothing`, [entityId, hit.id, evidenceId]);
  }
}
