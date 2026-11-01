// Loads seeds/*.yaml into the database. Idempotent: safe to run repeatedly.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { closeDb, db } from './index.ts';
import { upsertEvidence, writeFact, type FactMethod } from './facts.ts';
import { canonicalKey, type KeyType } from './keys.ts';

const seeds = join(import.meta.dirname, '..', '..', '..', 'seeds');
const load = async <T>(name: string): Promise<T> => parse(await readFile(join(seeds, name), 'utf8')) as T;

interface CapSeed { slug: string; en: string; zh: string }
interface AttrSeed { key: string; type: string; allowed?: unknown[]; deterministic: boolean; description: string }
interface FactSeed { attr: string; value: unknown; method: FactMethod; from: string; evidence: { url: string; quote?: string } }
interface EntitySeed {
  slug: string; type: string; name: string; aliases?: string[]; status: string; evidence_level: string;
  importance: number; summary_zh: string; summary_en: string; author?: string;
  keys?: Record<string, string>; capabilities?: string[]; facts?: FactSeed[];
  demos?: { url: string; requires: string[] }[];
  media?: { kind: string; file: string; origin: string; attribution: string; width: number; height: number }[];
}
interface SourceSeed { slug: string; kind: string; tier: string; interval: number; config: object; enabled?: boolean }
interface EntitiesFile {
  entities: EntitySeed[];
  relations: { src: string; dst: string; type: string; evidence?: string }[];
  insights: { entities: string[]; claim_zh: string; claim_en: string; author: string; reported_effect?: string; evidence_level: string; evidence: string }[];
  events: { entity: string; type: string; at: string; importance: number; decision: number; showcase: number; title: string; zh: string; summary_zh: string; source: string }[];
}

const c = await db().connect();
try {
  await c.query('begin');

  for (const cap of await load<CapSeed[]>('capabilities.yaml')) {
    const parent = cap.slug.includes('/') ? cap.slug.slice(0, cap.slug.lastIndexOf('/')) : null;
    await c.query(
      `insert into capability (slug, parent_id, name_en, name_zh)
       values ($1, (select id from capability where slug = $2), $3, $4)
       on conflict (slug) do update set parent_id = excluded.parent_id, name_en = excluded.name_en, name_zh = excluded.name_zh`,
      [cap.slug, parent, cap.en, cap.zh],
    );
  }

  for (const a of await load<AttrSeed[]>('attributes.yaml')) {
    await c.query(
      `insert into attribute (key, value_type, allowed_values, deterministic, description)
       values ($1, $2, $3, $4, $5)
       on conflict (key) do update set value_type = excluded.value_type, allowed_values = excluded.allowed_values,
         deterministic = excluded.deterministic, description = excluded.description`,
      [a.key, a.type, a.allowed ? JSON.stringify(a.allowed) : null, a.deterministic, a.description],
    );
  }

  const sources = await load<SourceSeed[]>('sources.yaml');
  for (const s of sources) {
    // state, health columns belong to the collector and are left alone
    await c.query(
      `insert into source (slug, kind, tier, interval_sec, config, enabled) values ($1, $2, $3, $4, $5, $6)
       on conflict (slug) do update set kind = excluded.kind, tier = excluded.tier, interval_sec = excluded.interval_sec,
         config = excluded.config, enabled = excluded.enabled`,
      [s.slug, s.kind, s.tier, s.interval, JSON.stringify(s.config), s.enabled ?? true],
    );
  }

  const file = await load<EntitiesFile>('entities.yaml');
  const ids = new Map<string, number>();
  const authors = new Map<string, string>();
  for (const e of file.entities) {
    const { rows } = await c.query<{ id: number }>(
      `insert into entity (slug, type, name, aliases, summary_en, summary_zh, status, evidence_level, importance, last_activity_at, curated)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), true)
       on conflict (slug) do update set type = excluded.type, name = excluded.name, aliases = excluded.aliases,
         summary_en = excluded.summary_en, summary_zh = excluded.summary_zh, status = excluded.status,
         evidence_level = excluded.evidence_level, importance = excluded.importance, curated = true
       returning id`,
      [e.slug, e.type, e.name, e.aliases ?? [], e.summary_en, e.summary_zh, e.status, e.evidence_level, e.importance],
    );
    const id = rows[0]!.id;
    ids.set(e.slug, id);
    if (e.author) authors.set(e.slug, e.author);

    for (const [type, key] of Object.entries(e.keys ?? {})) {
      await c.query(
        'insert into entity_key (entity_id, key_type, key) values ($1, $2, $3) on conflict (key_type, key) do update set entity_id = excluded.entity_id',
        [id, type, canonicalKey(type as KeyType, key)],
      );
    }
    for (const slug of e.capabilities ?? []) {
      await c.query(
        `insert into entity_capability (entity_id, capability_id, role)
         select $1, id, 'provides' from capability where slug = $2 on conflict do nothing`,
        [id, slug],
      );
    }
    for (const f of [...(e.facts ?? [])].sort((a, b) => String(a.from).localeCompare(String(b.from)))) {
      const seen = await c.query(
        'select 1 from fact where entity_id = $1 and attribute_key = $2 and valid_from = $3 and value = $4',
        [id, f.attr, new Date(f.from), JSON.stringify(f.value)],
      );
      if (seen.rowCount) continue;
      const evidenceId = await upsertEvidence(c, f.evidence.url, f.evidence.quote);
      await writeFact(c, { entityId: id, attribute: f.attr, value: f.value, at: new Date(f.from), method: f.method, evidenceId });
    }
    for (const d of e.demos ?? []) {
      await c.query(
        'insert into demo (entity_id, url, requires) values ($1, $2, $3) on conflict (url) do update set requires = excluded.requires',
        [id, d.url, d.requires],
      );
    }
    for (const m of e.media ?? []) {
      const exists = await c.query('select 1 from media where entity_id = $1 and r2_key = $2', [id, `media/${m.file}`]);
      if (exists.rowCount) continue;
      await c.query(
        `insert into media (entity_id, kind, origin, r2_key, width, height, attribution) values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, m.kind, m.origin, `media/${m.file}`, m.width, m.height, m.attribution],
      );
    }
  }

  const idOf = (slug: string): number => {
    const id = ids.get(slug);
    if (id == null) throw new Error(`unknown entity slug: ${slug}`);
    return id;
  };

  for (const r of file.relations) {
    const evidenceId = r.evidence ? await upsertEvidence(c, r.evidence) : null;
    await c.query(
      `insert into relation (src_id, dst_id, type, evidence_id) values ($1, $2, $3, $4)
       on conflict (src_id, dst_id, type) do update set evidence_id = excluded.evidence_id`,
      [idOf(r.src), idOf(r.dst), r.type, evidenceId],
    );
  }

  for (const i of file.insights) {
    const evidenceId = await upsertEvidence(c, i.evidence);
    const entityIds = i.entities.map(idOf);
    const exists = await c.query('select 1 from insight where claim_en = $1', [i.claim_en]);
    if (exists.rowCount) continue;
    await c.query(
      `insert into insight (entity_ids, claim_en, claim_zh, author, evidence_id, reported_effect, evidence_level)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [entityIds, i.claim_en, i.claim_zh, i.author, evidenceId, i.reported_effect ?? null, i.evidence_level],
    );
  }

  for (const ev of file.events) {
    await c.query(
      `insert into event (entity_id, type, occurred_at, published_at, importance, decision_value, showcase_value,
                          title, title_zh, summary_zh, source_url, payload, signal_count, source_diversity, cluster_key)
       values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $12, 1, 1, $11)
       on conflict (cluster_key) do update set importance = excluded.importance, decision_value = excluded.decision_value,
         showcase_value = excluded.showcase_value, title = excluded.title, title_zh = excluded.title_zh,
         summary_zh = excluded.summary_zh, source_url = excluded.source_url, payload = excluded.payload`,
      [idOf(ev.entity), ev.type, new Date(ev.at), ev.importance, ev.decision, ev.showcase, ev.title, ev.zh,
       ev.summary_zh, ev.source, `${ev.type}:${ev.entity}:${ev.at}`,
       JSON.stringify(authors.has(ev.entity) ? { author: authors.get(ev.entity) } : {})],
    );
  }

  await c.query('commit');
  console.log(`seeded ${sources.length} sources, ${ids.size} entities, ${file.relations.length} relations, ${file.insights.length} insights, ${file.events.length} events`);
} catch (err) {
  await c.query('rollback');
  throw err;
} finally {
  c.release();
  await closeDb();
}
