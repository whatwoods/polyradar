// pnpm eval — scores triage against seeds/eval/triage.yaml without writing
// anything except the LLM cache. Run after every prompt or model change.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { closeDb, db } from '@polyradar/db';
import { keysFromUrl, keyString } from '@polyradar/db/keys';
import { judge, loadContext, loadSignals } from './triage.ts';

interface Label { url: string; in_scope: boolean; runnable: boolean; entity: string; decision?: 'low' | 'mid' | 'high'; note?: string }

const PROMOTABLE = new Set(['demo', 'game', 'library', 'tool', 'model']);
const band = (v: number) => (v < 0.35 ? 'low' : v < 0.6 ? 'mid' : 'high');

const labels = parse(await readFile(join(import.meta.dirname, '..', '..', '..', 'seeds', 'eval', 'triage.yaml'), 'utf8')) as Label[];
const ctx = await loadContext();
const seeded = new Set((parse(await readFile(join(import.meta.dirname, '..', '..', '..', 'seeds', 'entities.yaml'), 'utf8')) as { entities: { slug: string }[] }).entities.map((e) => e.slug));
const score: Record<string, [ok: number, n: number]> = { in_scope: [0, 0], runnable: [0, 0], entity: [0, 0], decision: [0, 0] };
const misses: string[] = [];
const tally = (field: string, ok: boolean, detail: string) => {
  score[field]![1]++;
  if (ok) score[field]![0]++;
  else misses.push(`${field.padEnd(9)} ${detail}`);
};

for (const l of labels) {
  const found = await db().query<{ id: string }>('select g.id from signal g join raw_item r on r.id = g.raw_item_id where r.url = $1 limit 1', [l.url]);
  if (!found.rows[0]) { misses.push(`missing   ${l.url}`); continue; }
  const [s] = await loadSignals([Number(found.rows[0].id)]);
  const { t, subject, decision } = await judge(ctx, s!);
  const runnable = t.in_scope && subject != null && (t.kind === 'demo' || t.kind === 'game' || t.kind === 'tool') && !/github\.com/.test(subject);

  // Where promote() would land, computed read-only.
  let entity = 'none';
  const keyed = s!.entity_id ?? (subject
    ? (await db().query<{ entity_id: number }>(`select entity_id from entity_key where key_type || ':' || key = any($1) limit 1`,
        [keysFromUrl(subject).map(keyString)])).rows[0]?.entity_id ?? null
    : null);
  if (t.in_scope && keyed != null) entity = (await db().query<{ slug: string }>('select slug from entity where id = $1', [keyed])).rows[0]!.slug;
  else if (t.in_scope && PROMOTABLE.has(t.kind) && t.is_author && subject) entity = 'new';
  // Created by an earlier pipeline run rather than seeded: that is what "new" means.
  if (l.entity === 'new' && !seeded.has(entity) && entity !== 'none') entity = 'new';

  const name = s!.title.slice(0, 60);
  tally('in_scope', t.in_scope === l.in_scope, `${name}: got ${t.in_scope}`);
  tally('runnable', runnable === l.runnable, `${name}: got ${runnable} (${t.kind}, ${subject ?? 'no subject'})`);
  tally('entity', entity === l.entity, `${name}: got ${entity}, want ${l.entity}`);
  if (l.decision) tally('decision', band(decision) === l.decision, `${name}: got ${decision} (${band(decision)}), want ${l.decision}`);
}

for (const [k, [ok, n]] of Object.entries(score)) console.log(`${k.padEnd(9)} ${ok}/${n}  ${n ? Math.round((ok / n) * 100) : 0}%`);
if (misses.length) console.log(`\n${misses.join('\n')}`);
await closeDb();
