// One-shot collection without the queue, for development and backfills.
//   pnpm collect                     all enabled sources
//   pnpm collect discourse-threejs   one source
//   pnpm collect --renormalize hn    rebuild signals from stored raw items
import { closeDb, db } from '@polyradar/db';
import { ingestPackage } from '@polyradar/apidiff';
import { normalize, type Enqueue } from './normalize.ts';
import { pollSource } from './poll.ts';

const args = process.argv.slice(2);
const renormalize = args.includes('--renormalize');
let slugs = args.filter((a) => !a.startsWith('--'));
if (!slugs.length) {
  slugs = (await db().query<{ slug: string }>('select slug from source where enabled order by id')).rows.map((r) => r.slug);
}

const diffs = new Map<string, number>();
const enqueue: Enqueue = async (_task, p) => {
  diffs.set(p.package, Math.min(p.fromMinor, diffs.get(p.package) ?? Infinity));
};

let failed = 0;
for (const slug of slugs) {
  try {
    let ids: number[];
    if (renormalize) {
      ids = (await db().query<{ id: string }>(
        'select r.id from raw_item r join source s on s.id = r.source_id where s.slug = $1', [slug])).rows.map((r) => Number(r.id));
    } else {
      const res = await pollSource(slug);
      ids = res.inserted;
      console.log(`[${slug}] fetched ${res.fetched}, new ${ids.length}`);
    }
    const stats = await normalize(ids, enqueue);
    console.log(`[${slug}] ${JSON.stringify(stats)}`);
  } catch (err) {
    failed++;
    console.error(`[${slug}] failed: ${err instanceof Error ? err.message : err}`);
  }
}
for (const [pkg, fromMinor] of diffs) await ingestPackage(pkg, { fromMinor, emitEvents: true });
await closeDb();
process.exitCode = failed ? 1 : 0;
