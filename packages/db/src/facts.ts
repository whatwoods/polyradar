// Fact writes enforce PLAN §8.3: registered attributes only, one open value per
// (entity, attribute), and a fact_changed event whenever a value is replaced.
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';

export type FactMethod = 'api' | 'deterministic' | 'llm_extract' | 'human';

export interface FactInput {
  entityId: number;
  attribute: string;
  value: unknown;
  at: Date;
  method: FactMethod;
  confidence?: number;
  evidenceId?: number | null;
}

export type FactWriteResult = 'inserted' | 'unchanged' | 'replaced';

export async function writeFact(c: PoolClient, f: FactInput): Promise<FactWriteResult> {
  const attr = await c.query<{ value_type: string; allowed_values: unknown[] | null }>(
    'select value_type, allowed_values from attribute where key = $1',
    [f.attribute],
  );
  const def = attr.rows[0];
  if (!def) throw new Error(`unregistered attribute: ${f.attribute}`);
  assertAllowed(f.attribute, f.value, def.allowed_values);
  if (f.method === 'llm_extract' && f.evidenceId == null) {
    throw new Error(`llm_extract fact needs evidence: ${f.attribute}`);
  }

  const open = await c.query<{ id: string; value: unknown; valid_from: Date }>(
    'select id, value, valid_from from fact where entity_id = $1 and attribute_key = $2 and valid_to is null for update',
    [f.entityId, f.attribute],
  );
  const prev = open.rows[0];
  if (prev && isDeepStrictEqual(prev.value, f.value)) return 'unchanged';
  if (prev && prev.valid_from >= f.at) {
    throw new Error(`fact ${f.attribute} for entity ${f.entityId} is newer than ${f.at.toISOString()}`);
  }

  // Close the old value first: the partial unique index allows one open row.
  if (prev) await c.query('update fact set valid_to = $2 where id = $1', [prev.id, f.at]);
  const ins = await c.query<{ id: string }>(
    `insert into fact (entity_id, attribute_key, value, valid_from, method, confidence, evidence_id, verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, now()) returning id`,
    [f.entityId, f.attribute, JSON.stringify(f.value), f.at, f.method, f.confidence ?? 1, f.evidenceId ?? null],
  );
  if (!prev) return 'inserted';

  await c.query('update fact set superseded_by = $2 where id = $1', [prev.id, ins.rows[0]!.id]);
  await c.query(
    `insert into event (entity_id, type, occurred_at, importance, title, payload, cluster_key)
     values ($1, 'fact_changed', $2, 0.3, $3, $4, $5)
     on conflict (cluster_key) do nothing`,
    [
      f.entityId,
      f.at,
      `${f.attribute} changed`,
      JSON.stringify({ attribute: f.attribute, before: prev.value, after: f.value }),
      `fact_changed:${f.entityId}:${f.attribute}:${f.at.toISOString()}`,
    ],
  );
  return 'replaced';
}

function assertAllowed(key: string, value: unknown, allowed: unknown[] | null): void {
  if (!allowed) return;
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (!allowed.includes(v)) throw new Error(`${key}: ${JSON.stringify(v)} not in ${JSON.stringify(allowed)}`);
  }
}

export async function upsertEvidence(c: PoolClient, url: string, quote?: string | null): Promise<number> {
  const found = await c.query<{ id: string }>(
    'select id from evidence where url = $1 and quote is not distinct from $2 limit 1',
    [url, quote ?? null],
  );
  if (found.rows[0]) return Number(found.rows[0].id);
  const ins = await c.query<{ id: string }>('insert into evidence (url, quote) values ($1, $2) returning id', [url, quote ?? null]);
  return Number(ins.rows[0]!.id);
}
