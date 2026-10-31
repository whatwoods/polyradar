export const dynamic = 'force-static';

export function GET() {
  const body = `# Polyradar (三维雷达)

> Verifiable state of web real-time 3D and AI game creation: three.js / WebGL / WebGPU,
> procedural generation, AI 2D/3D asset tools, and demos. Facts carry validity dates,
> evidence links and an evidence level (E0 self-reported … E3 reproduced by us).

## For agents

- MCP (Streamable HTTP, stateless): /mcp — tools: search, get, compare, whats_new, check_api, get_demo, report
- Check a three.js API against a revision: /v1/check_api?symbol=WebGLRenderer.outputEncoding&version=r160
- Removed/deprecated symbols in a revision: /v1/changes?package=three&version=r187
- Search: /v1/search?q=gpu+particles
- Entity as JSON: /v1/entities/{slug} — as Markdown: /e/{slug}.md
- Events since a date: /v1/whats_new?since=2026-10-24
- Feed: /feed.json

## Rules

- E0 facts are unverified self-reports; say so when you repeat them.
- Fields the source did not state are absent, never guessed.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
