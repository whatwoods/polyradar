import pg from 'pg';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:54317/polyradar';

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type { PoolClient } from 'pg';
