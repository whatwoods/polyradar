import pg from 'pg';

const LOCAL_URL = 'postgres://localhost:54317/polyradar';

/** Read at use, not import: Worker entries set it from the Hyperdrive binding per invocation. */
export const databaseUrl = () => process.env.DATABASE_URL ?? LOCAL_URL;

// A Worker can't reuse a socket opened by another request, so there each query
// (or transaction) gets its own client; Hyperdrive pools the real connections.
const inWorker = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (inWorker) return perQuery;
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: 10 });
  return pool;
}

async function client(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: databaseUrl() });
  // Closing a Workers socket surfaces as a late 'error' event; query failures still reject their promise.
  c.on('error', () => {});
  await c.connect();
  return c;
}

const perQuery = {
  async query(...args: unknown[]) {
    const c = await client();
    try {
      return await (c.query as (...a: unknown[]) => Promise<unknown>)(...args);
    } finally {
      await c.end();
    }
  },
  async connect() {
    const c = await client();
    return Object.assign(c, { release: () => void c.end() });
  },
} as unknown as pg.Pool;

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type { PoolClient } from 'pg';
