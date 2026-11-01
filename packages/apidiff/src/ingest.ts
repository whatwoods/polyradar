// Backfills the API snapshot and change log for a tracked package.
//   pnpm apidiff            -> three, all minors since fromMinor
//   pnpm apidiff three 180  -> three, minors since 180
import { closeDb } from '@polyradar/db';
import { ingestPackage } from './run.ts';
import { localExtractor } from './local.ts';

const [name = 'three', fromArg] = process.argv.slice(2);
await ingestPackage(name, { fromMinor: fromArg ? Number(fromArg) : undefined, extract: localExtractor });
await closeDb();
