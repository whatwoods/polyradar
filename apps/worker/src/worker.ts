// Long-running worker: cron-driven source polling plus the processing queue.
import { run } from 'graphile-worker';
import { DATABASE_URL } from '@polyradar/db';
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
await runner.promise;
