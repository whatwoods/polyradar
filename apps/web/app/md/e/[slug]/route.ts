import { getEntity } from '@polyradar/db/queries/entities';
import { entityMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const e = await getEntity((await params).slug);
  if (!e) return new Response('not found\n', { status: 404 });
  return new Response(entityMarkdown(e, new URL(req.url).origin), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
