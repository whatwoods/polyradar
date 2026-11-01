// One-shot collection without Cloudflare: the same jobs as production, run
// through an in-process queue. For development and backfills.
//   pnpm collect                     all enabled polled sources
//   pnpm collect discourse-threejs   one source
//   pnpm collect --renormalize hn    rebuild signals from stored raw items
//   pnpm collect --retriage hn       renormalize, then re-run triage (LLM results are cached)
//   pnpm collect bluesky --seconds=60  listen to a stream for a while
import { closeDb, db } from '@polyradar/db';
import { localExtractor } from '@polyradar/apidiff/local';
import { runJob, type Job } from './jobs.ts';
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

// apidiff runs once per package at the end, from the oldest requested version.
const diffs = new Map<string, number>();
let queue: Job[] = [];
const ctx = {
  send: async (jobs: Job[]) => {
    for (const j of jobs) {
      if (j.task === 'apidiff') diffs.set(j.package, Math.min(j.fromMinor, diffs.get(j.package) ?? Infinity));
      else if (j.task !== 'triage' || retriage || !renormalize) queue.push(j);
    }
  },
  extract: localExtractor,
  log: (l: string) => console.log(l),
};

let failed = 0;
for (const slug of slugs) {
  const source = (await db().query<{ id: number; kind: string }>('select id, kind from source where slug = $1', [slug])).rows[0];
  if (!source) { failed++; console.error(`[${slug}] unknown source`); continue; }
  try {
    if (renormalize || retriage) {
      const ids = (await db().query<{ id: string }>('select id from raw_item where source_id = $1 order by id', [source.id])).rows.map((r) => Number(r.id));
      await ctx.send([{ task: 'normalize', ids }]);
    } else if (source.kind === 'bluesky') {
      await runJetstream(slug, { durationMs: seconds * 1000, onInserted: (ids) => ctx.send([{ task: 'normalize', ids }]) });
    } else {
      await ctx.send([{ task: 'poll_source', slug }]);
    }
    while (queue.length) {
      const [job] = queue.splice(0, 1);
      await runJob(job!, { ...ctx, log: (l) => console.log(l.startsWith('[') ? l : `[${slug}] ${l}`) });
    }
  } catch (err) {
    failed++;
    queue = [];
    console.error(`[${slug}] failed: ${err instanceof Error ? err.message : err}`);
  }
}
for (const [pkg, fromMinor] of diffs) await runJob({ task: 'apidiff', package: pkg, fromMinor }, ctx);
await closeDb();
process.exitCode = failed ? 1 : 0;
