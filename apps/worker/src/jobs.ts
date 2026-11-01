// Background jobs (PLAN §7.1). Runtime-neutral: the Cloudflare entry feeds them
// from Queues, `pnpm collect` runs the same steps inline.
import { db } from '@polyradar/db';
import { ingestPackage, type Extractor } from '@polyradar/apidiff';
import { llmConfigured } from '@polyradar/llm';
import { normalize } from './normalize.ts';
import { triage } from './triage.ts';
import { pollSource } from './poll.ts';

export type Job =
  | { task: 'poll_source'; slug: string }
  | { task: 'normalize'; ids: number[] }
  | { task: 'triage'; ids: number[] }
  | { task: 'apidiff'; package: string; fromMinor: number };

/** LLM and container work goes to a separate queue that runs one job at a time. */
export const SERIAL_TASKS = new Set<Job['task']>(['triage', 'apidiff']);

export interface JobContext {
  send: (jobs: Job[]) => Promise<void>;
  extract: Extractor;
  log: (line: string) => void;
}

const NORMALIZE_CHUNK = 200;
const TRIAGE_CHUNK = 50;

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Claims every enabled polled source whose interval has elapsed. Claiming (last_run_at) keeps a slow run from being queued twice. */
export async function dueSources(): Promise<string[]> {
  const { rows } = await db().query<{ slug: string }>(
    `update source set last_run_at = now()
     where enabled and kind <> 'bluesky' and (last_run_at is null or last_run_at + interval_sec * interval '1 second' <= now())
     returning slug`);
  return rows.map((r) => r.slug);
}

export async function streamSources(): Promise<string[]> {
  const { rows } = await db().query<{ slug: string }>(`select slug from source where enabled and kind = 'bluesky'`);
  return rows.map((r) => r.slug);
}

export async function runJob(job: Job, ctx: JobContext): Promise<void> {
  switch (job.task) {
    case 'poll_source': {
      const res = await pollSource(job.slug, ctx.log);
      ctx.log(`[${job.slug}] fetched ${res.fetched}, new ${res.inserted.length}`);
      await ctx.send(chunks(res.inserted, NORMALIZE_CHUNK).map((ids) => ({ task: 'normalize', ids })));
      return;
    }
    case 'normalize': {
      const queued = new Map<string, number>();
      const { triageIds, ...counts } = await normalize(job.ids, async (_task, p) => {
        queued.set(p.package, Math.min(p.fromMinor, queued.get(p.package) ?? Infinity));
      });
      ctx.log(`normalized ${job.ids.length}: ${JSON.stringify(counts)}`);
      const next: Job[] = [...queued].map(([pkg, fromMinor]) => ({ task: 'apidiff', package: pkg, fromMinor }));
      if (llmConfigured()) next.push(...chunks(triageIds, TRIAGE_CHUNK).map((ids) => ({ task: 'triage' as const, ids })));
      await ctx.send(next);
      return;
    }
    case 'triage': {
      const stats = await triage(job.ids, ctx.log);
      ctx.log(`triaged ${job.ids.length}: ${JSON.stringify(stats)}`);
      return;
    }
    case 'apidiff': {
      const res = await ingestPackage(job.package, { fromMinor: job.fromMinor, emitEvents: true, extract: ctx.extract, log: ctx.log });
      ctx.log(`apidiff ${job.package}: new versions ${res.added.join(', ') || 'none'}`);
      return;
    }
  }
}
