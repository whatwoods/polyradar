import type { Job } from '../jobs.ts';
import type { JetstreamStream } from './jetstream.ts';
import type { ApiDiffContainer } from './apidiff.ts';

export interface Env {
  HYPERDRIVE: Hyperdrive;
  JOBS: Queue<Job>;
  SERIAL: Queue<Job>;
  JETSTREAM: DurableObjectNamespace<JetstreamStream>;
  APIDIFF: DurableObjectNamespace<ApiDiffContainer>;
  /** Local dev without Docker: a running `pnpm --filter @polyradar/apidiff serve`. */
  APIDIFF_URL?: string;
  /** Local dev only: enables POST /enqueue. */
  DEV_ENQUEUE?: string;
}

/** Shared code reads the database URL from process.env; point it at Hyperdrive. */
export function bindEnv(env: Env): void {
  process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
}
