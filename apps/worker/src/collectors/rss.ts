// RSS 2.0 and Atom feeds (blogs, Reddit, YouTube). Optional `keywords` keep
// only entries that mention one of them, for broad feeds like the Chrome blog.
import { XMLParser } from 'fast-xml-parser';
import { getText } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', processEntities: true });

export interface FeedEntry { id: string; title: string; link: string | null; published: string | null; html: string; author: string | null }

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return '';
};
const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml);
  if (doc.rss) {
    return list<any>(doc.rss.channel?.item).map((it) => ({
      id: text(it.guid) || text(it.link),
      title: text(it.title),
      link: text(it.link) || null,
      published: text(it.pubDate) || text(it['dc:date']) || null,
      html: text(it['content:encoded']) || text(it.description),
      author: text(it['dc:creator']) || text(it.author) || null,
    }));
  }
  if (doc.feed) {
    return list<any>(doc.feed.entry).map((it) => {
      const links = list<any>(it.link);
      const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
      return {
        id: text(it.id) || alt?.['@href'],
        title: text(it.title),
        link: alt?.['@href'] ?? null,
        published: text(it.published) || text(it.updated) || null,
        html: text(it.content) || text(it.summary) || text(it['media:group']?.['media:description']),
        author: text(list<any>(it.author)[0]?.name) || null,
      };
    });
  }
  throw new Error('not an RSS or Atom document');
}

export const rss: Collector = async ({ source, state, log }) => {
  const res = await getText(source.config.url, { cache: state.cache, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' } });
  state.cache = res.cache;
  if (res.status === 304) { log('not modified'); return []; }
  const firstRun = !state.fetched;
  state.fetched = true;
  const keywords: string[] = (source.config.keywords ?? []).map((k: string) => k.toLowerCase());
  const entries = parseFeed(res.data).filter((e) => {
    if (!keywords.length) return true;
    const hay = `${e.title} ${e.html}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
  });
  log(`${entries.length} entries`);
  return entries.filter((e) => e.id).map((e) => {
    const t = e.published ? new Date(e.published) : null;
    return {
      external_id: e.id,
      url: e.link,
      published_at: t && !Number.isNaN(t.getTime()) ? t : null,
      backfill: firstRun,
      payload: { title: e.title, link: e.link, html: e.html.slice(0, 50_000), author: e.author },
    };
  });
};
