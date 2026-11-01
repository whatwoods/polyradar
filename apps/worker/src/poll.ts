// Runs one collector and records the result: raw items (immutable, deduped by
// (source, external_id)) plus the health columns the /sources page reads.
import { createHash } from 'node:crypto';
import { db } from '@polyradar/db';
import { COLLECTORS } from './collectors/index.ts';
import type { SourceRow } from './collectors/types.ts';

export interface PollResult { slug: string; fetched: number; inserted: number[]; warnings: string[] }

export async function pollSource(slug: string, log: (line: string) => void = console.log): Promise<PollResult> {
  const pool = db();
  const { rows } = await pool.query<SourceRow>(
    'select id, slug, kind, config, state, interval_sec, last_success_at from source where slug = $1', [slug]);
  const source = rows[0];
  if (!source) throw new Error(`unknown source ${slug}`);
  const collect = COLLECTORS[source.kind];
  if (!collect) throw new Error(`no collector for ${source.kind}`);

  const state = structuredClone(source.state);
  const warnings: string[] = [];
  try {
    const items = await collect({
      source,
      state,
      trackedKeys: async (type) => (await pool.query<{ key: string }>(
        `select k.key from entity_key k join entity e on e.id = k.entity_id
         where k.key_type = $1 and e.status <> 'archived' order by k.key`, [type])).rows.map((r) => r.key),
      log: (line) => log(`[${slug}] ${line}`),
      warn: (line) => { warnings.push(line); log(`[${slug}] warn ${line}`); },
    });

    const records = items.map((it) => ({
      external_id: it.external_id,
      url: it.url,
      published_at: it.published_at?.toISOString() ?? null,
      payload: it.payload,
      backfill: it.backfill ?? false,
      content_hash: createHash('sha256').update(JSON.stringify(it.payload)).digest('hex'),
    }));
    const ins = await pool.query<{ id: string }>(
      `insert into raw_item (source_id, external_id, url, published_at, content_hash, payload, backfill)
       select $1, r.external_id, r.url, r.published_at, r.content_hash, r.payload, r.backfill
       from jsonb_to_recordset($2::jsonb) as r(external_id text, url text, published_at timestamptz, content_hash text, payload jsonb, backfill boolean)
       on conflict (source_id, external_id) do nothing
       returning id`,
      [source.id, JSON.stringify(records)],
    );
    const inserted = ins.rows.map((r) => Number(r.id));

    state.warnings = warnings;
    await pool.query(
      `update source set state = $2, last_run_at = now(), last_success_at = now(), last_error = null, last_item_count = $3,
         lag_p90_sec = (select percentile_cont(0.9) within group (order by extract(epoch from fetched_at - published_at))::int
                        from raw_item where source_id = $1 and not backfill and published_at is not null
                          and fetched_at > now() - interval '7 days')
       where id = $1`,
      [source.id, JSON.stringify(state), inserted.length],
    );
    return { slug, fetched: items.length, inserted, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query('update source set last_run_at = now(), last_error = $2, last_error_at = now() where id = $1', [source.id, msg.slice(0, 1000)]);
    throw err;
  }
}
