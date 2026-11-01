// Cloudflare entry for background work (PLAN §7.1).
//   cron, every minute → claim due sources → JOBS queue; make sure each stream's Durable Object is running
//   JOBS   (parallel)   → poll_source, normalize
//   SERIAL (one at a time) → triage, apidiff
import { dueSources, runJob, SERIAL_TASKS, streamSources, type Job } from '../jobs.ts';
import { containerExtractor } from './apidiff.ts';
import { bindEnv, type Env } from './env.ts';

export { JetstreamStream } from './jetstream.ts';
export { ApiDiffContainer } from './apidiff.ts';

function sender(env: Env) {
  return async (jobs: Job[]) => {
    const serial = jobs.filter((j) => SERIAL_TASKS.has(j.task));
    const parallel = jobs.filter((j) => !SERIAL_TASKS.has(j.task));
    // sendBatch takes at most 100 messages.
    for (let i = 0; i < parallel.length; i += 100) await env.JOBS.sendBatch(parallel.slice(i, i + 100).map((body) => ({ body })));
    for (let i = 0; i < serial.length; i += 100) await env.SERIAL.sendBatch(serial.slice(i, i + 100).map((body) => ({ body })));
  };
}

export default {
  async scheduled(_event, env, ctx) {
    bindEnv(env);
    const slugs = await dueSources();
    await sender(env)(slugs.map((slug) => ({ task: 'poll_source', slug })));
    for (const slug of await streamSources()) {
      ctx.waitUntil(env.JETSTREAM.get(env.JETSTREAM.idFromName(slug)).start(slug));
    }
  },

  async queue(batch, env) {
    bindEnv(env);
    const ctx = { send: sender(env), extract: containerExtractor(env), log: (l: string) => console.log(l) };
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        await runJob(job, ctx);
        msg.ack();
      } catch (err) {
        console.error(`${job.task} failed: ${err instanceof Error ? err.stack : err}`);
        // A failed poll is already recorded on the source and retried by the next due tick.
        if (job.task === 'poll_source') msg.ack();
        else msg.retry({ delaySeconds: 60 * msg.attempts });
      }
    }
  },

  // The site is a separate Worker. Local dev can POST /enqueue to run a job by hand.
  async fetch(req, env) {
    if (env.DEV_ENQUEUE === '1' && req.method === 'POST' && new URL(req.url).pathname === '/enqueue') {
      await sender(env)([(await req.json()) as Job]);
      return new Response('queued');
    }
    return new Response('polyradar-jobs');
  },
} satisfies ExportedHandler<Env, Job>;
