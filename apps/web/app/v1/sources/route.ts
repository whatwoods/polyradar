import { sourceHealth } from '@polyradar/db/queries/sources';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sources = await sourceHealth();
  return Response.json({
    sources: sources.map((s) => ({
      slug: s.slug, kind: s.kind, tier: s.tier, status: s.status, interval_sec: s.interval_sec,
      last_success_at: s.last_success_at, last_error: s.status === 'error' ? s.last_error : null,
      lag_p90_sec: s.lag_p90_sec, items_24h: s.items_24h,
    })),
  });
}
