// The only way the system talks to an LLM (PLAN §7.1). Speaks the OpenAI
// chat-completions dialect so any compatible provider works; output is always
// validated against a zod schema, cached by model + input hash and logged.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@polyradar/db';

// Local runs read the repo's .env; Workers get vars and secrets in process.env.
if (import.meta.dirname) {
  try { process.loadEnvFile(`${import.meta.dirname}/../../../.env`); } catch { /* no .env */ }
}

export type Tier = 'fast' | 'smart';

export interface CompleteRequest<S extends z.ZodType> {
  /** What the call is for; groups cost and quality in llm_call. */
  purpose: string;
  tier?: Tier;
  system: string;
  user: string;
  schema: S;
  temperature?: number;
}

export class LlmError extends Error {}

function config(tier: Tier) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = tier === 'smart' ? process.env.LLM_MODEL_SMART : process.env.LLM_MODEL_FAST;
  if (!base || !key || !model) throw new LlmError('LLM_BASE_URL, LLM_API_KEY and LLM_MODEL_FAST/SMART must be set');
  return { base: base.replace(/\/$/, ''), key, model };
}

export const llmConfigured = () => !!(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL_FAST);

// Providers differ in how much of response_format they honour. Remember the
// first mode that works per model instead of probing on every call.
type Mode = 'json_schema' | 'json_object' | 'prompt';
const MODES: Mode[] = ['json_schema', 'json_object', 'prompt'];
const workingMode = new Map<string, Mode>();

/** Strict json_schema wants every object closed and every property required. */
function strictSchema(node: any): any {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: any = {};
  for (const [k, v] of Object.entries(node)) if (k !== '$schema') out[k] = strictSchema(v);
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

/** Pulls the JSON value out of a reply that may be fenced or wrapped in prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  try { return JSON.parse(body); } catch { /* fall through */ }
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
  throw new SyntaxError('no JSON in reply');
}

export async function complete<S extends z.ZodType>(req: CompleteRequest<S>): Promise<z.infer<S>> {
  const { base, key, model } = config(req.tier ?? 'fast');
  const jsonSchema = strictSchema(z.toJSONSchema(req.schema));
  const inputHash = createHash('sha256')
    .update(JSON.stringify([req.purpose, req.system, req.user, jsonSchema, req.temperature ?? 0]))
    .digest('hex');

  const cached = await db().query<{ output: unknown }>(
    'select output from llm_call where model = $1 and input_hash = $2 and output is not null', [model, inputHash]);
  if (cached.rows[0]) return req.schema.parse(cached.rows[0].output);

  let lastError: unknown;
  const modes = workingMode.has(model) ? [workingMode.get(model)!] : MODES;
  for (const mode of modes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const res = await call(base, key, model, mode, req, jsonSchema);
        const parsed = req.schema.safeParse(extractJson(res.text));
        if (!parsed.success) throw new LlmError(`schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        workingMode.set(model, mode);
        await log(req.purpose, model, inputHash, parsed.data, null, res.usage, Date.now() - t0);
        return parsed.data;
      } catch (err) {
        lastError = err;
        // The provider rejected this response_format: try the next mode.
        if (err instanceof HttpStatus && err.status === 400 && mode !== 'prompt') break;
        if (err instanceof HttpStatus && err.status !== 429 && err.status < 500) throw err;
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  await log(req.purpose, model, inputHash, null, msg, null, null);
  throw new LlmError(`${req.purpose}: ${msg}`);
}

class HttpStatus extends Error {
  constructor(readonly status: number, body: string) { super(`HTTP ${status}: ${body.slice(0, 300)}`); }
}

async function call(base: string, key: string, model: string, mode: Mode, req: CompleteRequest<z.ZodType>, jsonSchema: object) {
  const system = mode === 'json_schema' ? req.system
    : `${req.system}\n\nReply with a single JSON value matching this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`;
  const body: Record<string, unknown> = {
    model,
    temperature: req.temperature ?? 0,
    messages: [{ role: 'system', content: system }, { role: 'user', content: req.user }],
  };
  if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: req.purpose.replace(/\W/g, '_'), strict: true, schema: jsonSchema } };
  if (mode === 'json_object') body.response_format = { type: 'json_object' };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new HttpStatus(res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LlmError('empty reply');
  return { text, usage: data.usage ?? null };
}

async function log(purpose: string, model: string, inputHash: string, output: unknown, error: string | null,
  usage: { prompt_tokens?: number; completion_tokens?: number } | null, ms: number | null) {
  await db().query(
    `insert into llm_call (purpose, model, input_hash, output, error, prompt_tokens, completion_tokens, ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (model, input_hash) do update set output = excluded.output, error = excluded.error,
       prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens, ms = excluded.ms, created_at = now()`,
    [purpose, model, inputHash, output == null ? null : JSON.stringify(output), error, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, ms],
  );
}
