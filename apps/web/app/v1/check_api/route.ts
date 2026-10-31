import { checkApi } from '@polyradar/db/queries/api';
import { logQuery } from '@polyradar/db/queries/entities';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol) return Response.json({ error: 'symbol is required' }, { status: 400 });
  const pkg = url.searchParams.get('package') ?? 'three';
  const result = await checkApi(pkg, symbol, url.searchParams.get('version'));
  await logQuery('rest', symbol, { endpoint: 'check_api', pkg }, result?.matches.length ?? 0, req.headers.get('user-agent'));
  return result ? Response.json(result) : Response.json({ error: `no API data for ${pkg}` }, { status: 404 });
}
