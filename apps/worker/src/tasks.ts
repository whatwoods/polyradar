// Graphile Worker task list (PLAN §7.1): the queue lives in Postgres.
import type { Task, TaskList } from 'graphile-worker';
import { db } from '@polyradar/db';
import { ingestPackage } from '@polyradar/apidiff';
import { normalize } from './normalize.ts';
import { pollSource } from './poll.ts';

const CHUNK = 200;

/** Every minute: enqueue each enabled source whose interval has elapsed. */
const schedule_sources: Task = async (_payload, helpers) => {
  // Claiming the slot here (last_run_at) keeps a slow run from being queued twice.
  const { rows } = await db().query<{ slug: string }>(
    `update source set last_run_at = now()
     where enabled and (last_run_at is null or last_run_at + interval_sec * interval '1 second' <= now())
     returning slug`);
  for (const { slug } of rows) {
    await helpers.addJob('poll_source', { slug }, { jobKey: `poll:${slug}`, maxAttempts: 1 });
  }
};

const poll_source: Task = async (payload, helpers) => {
  const { slug } = payload as { slug: string };
  const res = await pollSource(slug, (line) => helpers.logger.info(line));
  for (let i = 0; i < res.inserted.length; i += CHUNK) {
    await helpers.addJob('normalize', { ids: res.inserted.slice(i, i + CHUNK) }, { queueName: 'normalize' });
  }
};

const normalizeTask: Task = async (payload, helpers) => {
  const { ids } = payload as { ids: number[] };
  const stats = await normalize(ids, async (task, p) => {
    // One diff per package at a time; a newer request replaces a queued one.
    await helpers.addJob(task, p, { jobKey: `${task}:${p.package}`, queueName: task });
  });
  helpers.logger.info(`normalized ${ids.length}: ${JSON.stringify(stats)}`);
};

const apidiff: Task = async (payload, helpers) => {
  const { package: pkg, fromMinor } = payload as { package: string; fromMinor: number };
  const res = await ingestPackage(pkg, { fromMinor, emitEvents: true, log: (l) => helpers.logger.info(l) });
  helpers.logger.info(`apidiff ${pkg}: new versions ${res.added.join(', ') || 'none'}`);
};

export const taskList: TaskList = { schedule_sources, poll_source, normalize: normalizeTask, apidiff };
