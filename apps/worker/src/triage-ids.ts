// pnpm --filter @polyradar/worker exec tsx src/triage-ids.ts <signal ids…> — triage specific signals.
import { closeDb } from '@polyradar/db';
import { triage } from './triage.ts';

console.log(await triage(process.argv.slice(2).map(Number).filter(Number.isInteger)));
await closeDb();
