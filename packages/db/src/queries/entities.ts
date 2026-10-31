// Read side for entities, the radar feed and search. Shared by web, REST and MCP.
import { db } from '../index.ts';

export interface EntitySummary {
  slug: string; type: string; name: string; summary_zh: string | null; summary_en: string | null;
  status: string; evidence_level: string | null; importance: number;
}

export interface FactRow {
  attribute: string; value: unknown; valid_from: Date; valid_to: Date | null;
  method: string; evidence_url: string | null; evidence_quote: string | null;
}

export interface EntityDetail extends EntitySummary {
  aliases: string[];
  keys: { key_type: string; key: string }[];
  capabilities: { slug: string; name_zh: string; name_en: string }[];
  facts: FactRow[];
  relations: { direction: 'out' | 'in'; type: string; slug: string; name: string }[];
  insights: { claim_zh: string | null; claim_en: string; author: string | null; evidence_level: string; reported_effect: string | null; evidence_url: string | null }[];
  demos: { url: string; requires: string[]; status: string; last_checked_at: Date | null }[];
  media: { kind: string; path: string; width: number | null; height: number | null; attribution: string | null }[];
  events: FeedEvent[];
}

export interface FeedEvent {
  id: string; type: string; occurred_at: Date; title: string; title_zh: string | null; summary_zh: string | null;
  decision_value: number | null; showcase_value: number | null; source_url: string | null; payload: Record<string, unknown>;
  entity_slug: string | null; entity_name: string | null; entity_type: string | null; evidence_level: string | null;
  capabilities: string[]; media_path: string | null;
}

const ENTITY_COLS = 'e.slug, e.type, e.name, e.summary_zh, e.summary_en, e.status, e.evidence_level, e.importance';

const FEED_SELECT = `
  select ev.id::text, ev.type, ev.occurred_at, ev.title, ev.title_zh, ev.summary_zh, ev.decision_value, ev.showcase_value,
         ev.source_url, ev.payload, e.slug as entity_slug, e.name as entity_name, e.type as entity_type, e.evidence_level,
         coalesce((select array_agg(c.slug order by c.slug) from entity_capability ec join capability c on c.id = ec.capability_id
                   where ec.entity_id = e.id), '{}') as capabilities,
         coalesce(
           (select m.r2_key from media m where m.entity_id = e.id and m.kind = 'image' order by m.id limit 1),
           -- no own image: borrow one from a demo built with this entity
           (select m.r2_key from relation r join media m on m.entity_id = r.src_id
            where r.dst_id = e.id and r.type = 'built_with' and m.kind = 'image' order by m.id limit 1)
         ) as media_path
  from event ev left join entity e on e.id = ev.entity_id`;

export async function getEntity(slug: string): Promise<EntityDetail | null> {
  const pool = db();
  const base = await pool.query<EntitySummary & { id: number; aliases: string[] }>(
    `select e.id, e.aliases, ${ENTITY_COLS} from entity e where e.slug = $1`,
    [slug],
  );
  const e = base.rows[0];
  if (!e) return null;

  const [keys, caps, facts, rels, insights, demos, media, events] = await Promise.all([
    pool.query('select key_type, key from entity_key where entity_id = $1 order by key_type', [e.id]),
    pool.query(
      `select c.slug, c.name_zh, c.name_en from entity_capability ec join capability c on c.id = ec.capability_id
       where ec.entity_id = $1 order by c.slug`, [e.id]),
    pool.query(
      `select f.attribute_key as attribute, f.value, f.valid_from, f.valid_to, f.method, ev.url as evidence_url, ev.quote as evidence_quote
       from fact f left join evidence ev on ev.id = f.evidence_id
       where f.entity_id = $1 order by f.attribute_key, f.valid_from desc`, [e.id]),
    pool.query(
      `select 'out' as direction, r.type, d.slug, d.name from relation r join entity d on d.id = r.dst_id where r.src_id = $1 and r.valid_to is null
       union all
       select 'in', r.type, s.slug, s.name from relation r join entity s on s.id = r.src_id where r.dst_id = $1 and r.valid_to is null
       order by 2, 4`, [e.id]),
    pool.query(
      `select i.claim_zh, i.claim_en, i.author, i.evidence_level, i.reported_effect, ev.url as evidence_url
       from insight i left join evidence ev on ev.id = i.evidence_id where $1 = any(i.entity_ids) order by i.id`, [e.id]),
    pool.query('select url, requires, status, last_checked_at from demo where entity_id = $1 order by id', [e.id]),
    pool.query('select kind, r2_key as path, width, height, attribution from media where entity_id = $1 order by id', [e.id]),
    pool.query<FeedEvent>(`${FEED_SELECT} where ev.entity_id = $1 order by ev.occurred_at desc limit 50`, [e.id]),
  ]);

  const { id: _id, ...summary } = e;
  return {
    ...summary,
    keys: keys.rows, capabilities: caps.rows, facts: facts.rows, relations: rels.rows,
    insights: insights.rows, demos: demos.rows, media: media.rows, events: events.rows,
  };
}

/** Radar: events ranked by decision value (PLAN §3.6). Showcase-only items are excluded. */
export async function radar(from: Date, to: Date, minDecision = 0.4): Promise<FeedEvent[]> {
  const { rows } = await db().query<FeedEvent>(
    `${FEED_SELECT} where ev.occurred_at >= $1 and ev.occurred_at < $2 and ev.decision_value >= $3
     order by ev.decision_value desc, ev.occurred_at desc`,
    [from, to, minDecision],
  );
  return rows;
}

export async function showcase(limit = 24): Promise<FeedEvent[]> {
  const { rows } = await db().query<FeedEvent>(
    `${FEED_SELECT} where ev.showcase_value is not null and ev.type = 'demo_published'
     order by ev.showcase_value desc, ev.occurred_at desc limit $1`,
    [limit],
  );
  return rows;
}

/** Everything since a point in time, newest first; fact changes included. */
export async function whatsNew(since: Date, opts: { minDecision?: number; limit?: number } = {}): Promise<FeedEvent[]> {
  const { rows } = await db().query<FeedEvent>(
    `${FEED_SELECT} where ev.occurred_at >= $1 and (ev.decision_value is null or ev.decision_value >= $2)
     order by ev.occurred_at desc limit $3`,
    [since, opts.minDecision ?? 0.4, opts.limit ?? 50],
  );
  return rows;
}

export async function searchEntities(q: string, opts: { type?: string; capability?: string; limit?: number } = {}): Promise<EntitySummary[]> {
  const term = q.trim().toLowerCase();
  const { rows } = await db().query<EntitySummary>(
    `select ${ENTITY_COLS} from entity e
     where ($1 = '' or e.search_tsv @@ plainto_tsquery('simple', $1) or e.search_text like '%' || $1 || '%')
       and ($2::text is null or e.type = $2)
       and ($3::text is null or exists (
             select 1 from entity_capability ec join capability c on c.id = ec.capability_id
             where ec.entity_id = e.id and (c.slug = $3 or c.slug like $3 || '/%')))
       and e.status <> 'archived'
     order by (lower(e.name) = $1) desc, ts_rank(e.search_tsv, plainto_tsquery('simple', $1)) desc, e.importance desc
     limit $4`,
    [term, opts.type ?? null, opts.capability ?? null, opts.limit ?? 20],
  );
  return rows;
}

export async function capabilityTree(): Promise<{ slug: string; name_zh: string; name_en: string; entity_count: number }[]> {
  const { rows } = await db().query(
    `select c.slug, c.name_zh, c.name_en,
            (select count(distinct ec.entity_id)::int from entity_capability ec join capability c2 on c2.id = ec.capability_id
             where c2.slug = c.slug or c2.slug like c.slug || '/%') as entity_count
     from capability c order by c.slug`,
  );
  return rows;
}

export async function logQuery(channel: 'web' | 'rest' | 'mcp', query: string, filters: object, resultCount: number, client?: string | null): Promise<void> {
  await db().query(
    'insert into query_log (channel, query, filters, result_count, client) values ($1, $2, $3, $4, $5)',
    [channel, query, JSON.stringify(filters), resultCount, client ?? null],
  );
}
