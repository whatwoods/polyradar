// One-shot collection without the queue, for development and backfills.
//   pnpm collect                     all enabled sources
//   pnpm collect discourse-threejs   one source
//   pnpm collect --renormalize hn    rebuild signals from stored raw items
//   pnpm collect --retriage hn       renormalize, then re-run triage (LLM results are cached)
//   pnpm collect bluesky --seconds=60  listen to a stream for a while
import { closeDb, db } from '@polyradar/db';
import { ingestPackage } from '@polyradar/apidiff';
import { llmConfigured } from '@polyradar/llm';
import { normalize, type Enqueue } from './normalize.ts';
import { triage } from './triage.ts';
import { pollSource } from './poll.ts';
import { runJetstream } from './streams/jetstream.ts';

const args = process.argv.slice(2);
const renormalize = args.includes('--renormalize');
const retriage = args.includes('--retriage');
const seconds = Number(args.find((a) => a.startsWith('--seconds='))?.slice(10) ?? 60);
let slugs = args.filter((a) => !a.startsWith('--'));
if (!slugs.length) {
  // Streams only run when named.
  slugs = (await db().query<{ slug: string }>(`select slug from source where enabled and kind <> 'bluesky' order by id`)).rows.map((r) => r.slug);
}

const diffs = new Map<string, number>();
const enqueue: Enqueue = async (_task, p) => {
  diffs.set(p.package, Math.min(p.fromMinor, diffs.get(p.package) ?? Infinity));
};

let failed = 0;
for (const slug of slugs) {
  try {
    let ids: number[];
    // Retriage renormalizes first so rule relevance isn't left over from the previous verdict.
    if (renormalize || retriage) {
      ids = (await db().query<{ id: string }>(
        'select r.id from raw_item r join source s on s.id = r.source_id where s.slug = $1', [slug])).rows.map((r) => Number(r.id));
    } else if ((await db().query('select 1 from source where slug = $1 and kind = $2', [slug, 'bluesky'])).rowCount) {
      ids = [];
      const h = await runJetstream(slug, { durationMs: seconds * 1000, onInserted: async (x) => { ids.push(...x); } });
      await h.done;
      console.log(`[${slug}] listened ${seconds}s, new ${ids.length}`);
    } else {
      const res = await pollSource(slug);
      ids = res.inserted;
      console.log(`[${slug}] fetched ${res.fetched}, new ${ids.length}`);
    }
    const { triageIds, ...stats } = await normalize(ids, enqueue);
    console.log(`[${slug}] ${JSON.stringify(stats)}`);
    if (triageIds.length && llmConfigured() && (retriage || !renormalize)) console.log(`[${slug}] triage ${JSON.stringify(await triage(triageIds))}`);
  } catch (err) {
    failed++;
    console.error(`[${slug}] failed: ${err instanceof Error ? err.message : err}`);
  }
}
for (const [pkg, fromMinor] of diffs) await ingestPackage(pkg, { fromMinor, emitEvents: true });
await closeDb();
process.exitCode = failed ? 1 : 0;
