import { logQuery, searchEntities } from '@polyradar/db/queries/entities';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const rows = await searchEntities(q, {
    type: url.searchParams.get('type') ?? undefined,
    capability: url.searchParams.get('capability') ?? undefined,
    limit: Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 50),
  });
  await logQuery('rest', q, { endpoint: 'search' }, rows.length, req.headers.get('user-agent'));
  return Response.json(rows);
}
