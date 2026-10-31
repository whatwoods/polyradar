import { whatsNew } from '@polyradar/db/queries/entities';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const since = new Date(new URL(req.url).searchParams.get('since') ?? Date.now() - 7 * 86400_000);
  if (Number.isNaN(since.getTime())) return Response.json({ error: 'since must be an ISO date' }, { status: 400 });
  return Response.json(await whatsNew(since));
}
