// Evidence-backed fact extraction (PLAN §4.2 富化抽取, §8.3): every value
// needs a verbatim quote from the post, the quote must really be there, and
// free-text values must appear inside it. Anything else is dropped.
import { z } from 'zod';
import { db } from '@polyradar/db';
import { upsertEvidence, writeFact } from '@polyradar/db/facts';
import { complete } from '@polyradar/llm';
import type { SignalForTriage } from './triage.ts';

// Attributes a post can state. Runtime observations (renderer, load size,
// engine version) come from the capture worker, never from text.
const EXTRACTABLE = [
  'license_spdx', 'license_custom_terms', 'source_available', 'has_docs', 'docs_url', 'latest_version',
  'runtime_requirements', 'input_modalities', 'output_formats', 'pricing_model', 'external_assets', 'web_readiness',
] as const;
/** Values that must literally occur in the quote. */
const LITERAL = new Set(['license_spdx', 'docs_url', 'latest_version']);

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
export const quoteIn = (quote: string, text: string) => quote.trim().length >= 8 && squash(text).includes(squash(quote));

const Schema = z.object({
  facts: z.array(z.object({
    attribute: z.enum(EXTRACTABLE),
    value: z.string(),
    quote: z.string(),
  })),
});

interface AttrDef { key: string; value_type: string; allowed_values: string[] | null; description: string }

export async function extractFacts(entityId: number, s: SignalForTriage, created: boolean): Promise<number> {
  if (!s.post_url) return 0;
  const defs = (await db().query<AttrDef>(
    'select key, value_type, allowed_values, description from attribute where key = any($1)', [EXTRACTABLE])).rows;
  const text = `${s.title}\n${s.text}`.slice(0, 6000);
  const out = await complete({
    purpose: 'extract-v1',
    tier: 'fast',
    system: `Extract facts about the project presented in a post. Only facts the post states explicitly; when the post does not say, output nothing for that attribute. Each fact needs a verbatim quote (copied exactly, at most 300 characters) that states it.
Attributes:
${defs.map((d) => `- ${d.key} (${d.value_type}${d.allowed_values ? `: one of ${d.allowed_values.join(', ')}` : ''}): ${d.description}`).join('\n')}
Encode value as text: booleans "true"/"false"; lists comma-separated; versions as written.`,
    user: text,
    schema: Schema,
  });

  let written = 0;
  for (const f of out.facts) {
    const def = defs.find((d) => d.key === f.attribute);
    if (!def || !quoteIn(f.quote, text)) continue;
    const value = parseValue(def, f.value);
    if (value == null) continue;
    if (LITERAL.has(f.attribute) && !squash(f.quote).includes(squash(String(value)))) continue;

    const c = await db().connect();
    try {
      await c.query('begin');
      // An LLM value never overrides a deterministic or human one: queue it for review instead (PLAN §4.3).
      const open = await c.query<{ value: unknown; method: string }>(
        'select value, method from fact where entity_id = $1 and attribute_key = $2 and valid_to is null', [entityId, f.attribute]);
      const prev = open.rows[0];
      if (prev && prev.method !== 'llm_extract' && JSON.stringify(prev.value) !== JSON.stringify(value)) {
        await c.query(
          `insert into review_task (entity_id, reason, payload) values ($1, 'fact_conflict', $2)`,
          [entityId, JSON.stringify({ attribute: f.attribute, current: prev.value, current_method: prev.method, proposed: value, quote: f.quote, url: s.post_url })]);
      } else {
        const evidenceId = await upsertEvidence(c, s.post_url, f.quote);
        const r = await writeFact(c, {
          entityId, attribute: f.attribute, value, at: s.published_at, method: 'llm_extract', confidence: 0.7, evidenceId,
          ignoreStale: true, quiet: created,
        });
        if (r !== 'unchanged' && r !== 'stale') written++;
      }
      await c.query('commit');
    } catch (err) {
      await c.query('rollback');
      // A value outside the registry is the model's mistake, not a pipeline failure.
      if (!(err instanceof Error && /not in|unregistered/.test(err.message))) throw err;
    } finally {
      c.release();
    }
  }
  return written;
}

function parseValue(def: AttrDef, raw: string): unknown {
  const v = raw.trim();
  if (!v) return null;
  switch (def.value_type) {
    case 'boolean': return v === 'true' ? true : v === 'false' ? false : null;
    case 'string[]': {
      const list = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      return list.length ? list : null;
    }
    case 'number': case 'bytes': { const n = Number(v); return Number.isFinite(n) ? n : null; }
    case 'enum': return v.toLowerCase();
    default: return v;
  }
}
