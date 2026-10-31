import { getEntity } from '@polyradar/db/queries/entities';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const e = await getEntity((await params).slug);
  return e ? Response.json(e) : Response.json({ error: 'not found' }, { status: 404 });
}
