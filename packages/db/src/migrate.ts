// Applies migrations/*.sql in name order, each once, inside a transaction.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, db } from './index.ts';

const dir = join(import.meta.dirname, '..', 'migrations');

await db().query('create table if not exists _migration (name text primary key, applied_at timestamptz not null default now())');
const { rows } = await db().query<{ name: string }>('select name from _migration');
const applied = new Set(rows.map((r) => r.name));

for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(name)) continue;
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(await readFile(join(dir, name), 'utf8'));
    await client.query('insert into _migration (name) values ($1)', [name]);
    await client.query('commit');
    console.log(`applied ${name}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
await closeDb();
