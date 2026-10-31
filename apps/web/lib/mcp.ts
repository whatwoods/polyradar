// MCP server definition (PLAN §5.2). Stateless: a fresh server per request.
// find_pipeline is P2 and intentionally absent.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '@polyradar/db';
import { checkApi } from '@polyradar/db/queries/api';
import { getEntity, logQuery, searchEntities, whatsNew } from '@polyradar/db/queries/entities';
import { entityMarkdown } from './markdown';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

export function createMcpServer(origin: string, client: string | null): McpServer {
  const server = new McpServer({ name: 'polyradar', version: '0.1.0' });

  server.registerTool('search', {
    description: 'Find libraries, engines, AI asset tools, models, papers, demos and techniques for web real-time 3D and AI game creation. Returns slugs to pass to `get`.',
    inputSchema: {
      query: z.string().describe('Free text, English or Chinese. Empty string lists by importance.'),
      type: z.enum(['library', 'engine', 'tool', 'model', 'paper', 'demo', 'game', 'technique', 'service', 'dataset']).optional(),
      capability: z.string().optional().describe('Capability slug prefix, e.g. "render/particles" or "asset/3d"'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, type, capability, limit }) => {
    const rows = await searchEntities(query, { type, capability, limit });
    await logQuery('mcp', query, { tool: 'search', type, capability }, rows.length, client);
    return json(rows.map((r) => ({ slug: r.slug, name: r.name, type: r.type, evidence: r.evidence_level, summary: r.summary_en })));
  });

  server.registerTool('get', {
    description: 'Everything known about one entity: facts with validity dates and evidence links, insights, relations, demos, timeline. Facts with evidence E0 are unverified self-reports.',
    inputSchema: { slug: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ slug }) => {
    const e = await getEntity(slug);
    await logQuery('mcp', slug, { tool: 'get' }, e ? 1 : 0, client);
    return e ? text(entityMarkdown(e, origin)) : text(`No entity "${slug}". Use the search tool first.`);
  });

  server.registerTool('compare', {
    description: 'Side-by-side current facts for 2–5 entities.',
    inputSchema: { slugs: z.array(z.string()).min(2).max(5) },
    annotations: { readOnlyHint: true },
  }, async ({ slugs }) => {
    const entities = (await Promise.all(slugs.map(getEntity))).filter((e) => e !== null);
    const attrs = [...new Set(entities.flatMap((e) => e.facts.filter((f) => !f.valid_to).map((f) => f.attribute)))].sort();
    const table = Object.fromEntries(entities.map((e) => [e.slug, {
      name: e.name, type: e.type, evidence: e.evidence_level,
      ...Object.fromEntries(attrs.map((a) => [a, e.facts.find((f) => f.attribute === a && !f.valid_to)?.value ?? null])),
    }]));
    return json({ attributes: attrs, entities: table, missing: slugs.filter((s) => !entities.some((e) => e.slug === s)) });
  });

  server.registerTool('whats_new', {
    description: 'Events since a date, ranked for decision value: releases, demos with transferable techniques, fact changes. Showcase-only items are left out to save context.',
    inputSchema: {
      since: z.string().describe('ISO date, e.g. 2026-10-24'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, limit }) => {
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) return text(`Invalid date: ${since}`);
    const rows = await whatsNew(date, { limit });
    await logQuery('mcp', since, { tool: 'whats_new' }, rows.length, client);
    return json(rows.map((r) => ({
      date: r.occurred_at, type: r.type, title: r.title, entity: r.entity_slug,
      decision_value: r.decision_value, evidence: r.evidence_level, source: r.source_url, change: r.type === 'fact_changed' ? r.payload : undefined,
    })));
  });

  server.registerTool('check_api', {
    description: 'Check whether a three.js API exists in a given revision, when it was added/deprecated/removed, and what replaces it. Deterministic, from @types/three .d.ts diffs. Use before writing three.js code against a specific version.',
    inputSchema: {
      symbol: z.string().describe('e.g. "WebGLRenderer.outputEncoding", "renderer.outputEncoding", "compileAsync"'),
      version: z.string().optional().describe('e.g. "r160", "0.160.0"; defaults to latest'),
      package: z.enum(['three']).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ symbol, version, package: pkg }) => {
    const r = await checkApi(pkg ?? 'three', symbol, version ?? null);
    await logQuery('mcp', symbol, { tool: 'check_api', version }, r?.matches.length ?? 0, client);
    if (!r) return text('No API data for that package yet.');
    return json({ ...r, matches: r.matches.map(({ history, ...m }) => ({ ...m, history_len: history.length })) });
  });

  server.registerTool('get_demo', {
    description: 'Demo URLs for an entity with requirements (webgl2/webgpu/webxr) and the latest automated check, if any.',
    inputSchema: { slug: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ slug }) => {
    const { rows } = await db().query(
      `select d.url, d.requires, d.status, d.last_checked_at,
              (select row_to_json(c) from (select checked_at, renderer, loaded, console_errors, first_frame_ms, fingerprint
                 from demo_check where demo_id = d.id order by checked_at desc limit 1) c) as last_check
       from demo d join entity e on e.id = d.entity_id where e.slug = $1`,
      [slug],
    );
    return json(rows);
  });

  server.registerTool('report', {
    description: 'Report a wrong, outdated or missing fact. Goes to the editorial review queue.',
    inputSchema: {
      slug: z.string().optional(),
      message: z.string().min(5).max(2000),
      evidence_url: z.string().url().optional(),
    },
  }, async ({ slug, message, evidence_url }) => {
    await db().query(
      `insert into review_task (entity_id, reason, payload) values ((select id from entity where slug = $1), 'agent_report', $2)`,
      [slug ?? null, JSON.stringify({ message, evidence_url, client })],
    );
    return text('Thanks — queued for review.');
  });

  return server;
}
