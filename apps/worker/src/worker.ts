// Long-running worker: cron-driven source polling, live streams, and the
// processing queue.
import { run } from 'graphile-worker';
import { DATABASE_URL, db } from '@polyradar/db';
import { runJetstream, type StreamHandle } from './streams/jetstream.ts';
import { taskList } from './tasks.ts';

const runner = await run({
  connectionString: DATABASE_URL,
  concurrency: 4,
  pollInterval: 2000,
  taskList,
  crontab: '* * * * * schedule_sources',
});
// Don't wait up to a minute for the first cron tick.
await runner.addJob('schedule_sources', {});

const streams: StreamHandle[] = [];
for (const { slug } of (await db().query<{ slug: string }>(`select slug from source where enabled and kind = 'bluesky'`)).rows) {
  streams.push(await runJetstream(slug, {
    onInserted: async (ids) => { await runner.addJob('normalize', { ids }, { queueName: 'normalize' }); },
    log: (l) => console.log(l),
  }));
}
runner.events.on('stop', () => { for (const s of streams) void s.stop(); });

await runner.promise;
