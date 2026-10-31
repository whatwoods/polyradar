import { changesIn } from '@polyradar/db/queries/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const version = url.searchParams.get('version');
  if (!version) return Response.json({ error: 'version is required, e.g. r187' }, { status: 400 });
  const kinds = url.searchParams.get('kinds')?.split(',') ?? ['removed', 'deprecated'];
  return Response.json(await changesIn(url.searchParams.get('package') ?? 'three', version, kinds, 5000));
}
