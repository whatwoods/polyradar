import { whatsNew } from '@polyradar/db/queries/entities';

export const dynamic = 'force-dynamic';

// JSON Feed 1.1 of decision-ranked events from the last 30 days.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const events = await whatsNew(new Date(Date.now() - 30 * 86400_000), { limit: 100 });
  return Response.json({
    version: 'https://jsonfeed.org/version/1.1',
    title: '三维雷达 Polyradar',
    home_page_url: origin,
    feed_url: `${origin}/feed.json`,
    language: 'zh-CN',
    items: events.map((e) => ({
      id: e.id,
      url: e.entity_slug ? `${origin}/e/${e.entity_slug}` : e.source_url,
      external_url: e.source_url ?? undefined,
      title: e.title_zh ?? e.title,
      content_text: e.summary_zh ?? e.title,
      date_published: new Date(e.occurred_at).toISOString(),
      tags: [e.type, ...e.capabilities],
    })),
  }, { headers: { 'content-type': 'application/feed+json; charset=utf-8' } });
}
