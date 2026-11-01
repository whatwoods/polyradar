// pnpm --filter @polyradar/llm smoke — one real call through the adapter.
import { z } from 'zod';
import { closeDb } from '@polyradar/db';
import { complete } from './index.ts';

const t0 = Date.now();
const out = await complete({
  purpose: 'smoke',
  system: 'You classify forum posts about web 3D.',
  user: 'Post title: "Cinderwake – a survivors-style ARPG in the browser (three.js WebGPU + TSL)". Is this a playable web demo, and which renderer does it use?',
  schema: z.object({ is_demo: z.boolean(), renderer: z.enum(['webgl2', 'webgpu', 'unknown']), confidence: z.number().min(0).max(1) }),
});
console.log(out, `${Date.now() - t0}ms`);
await closeDb();
