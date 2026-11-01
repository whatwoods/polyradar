// arXiv (PLAN §4.1): graphics papers in full, plus keyword matches from the
// vision/AI/HCI lists. The API asks for one request every three seconds.
import { XMLParser } from 'fast-xml-parser';
import { getText, pause } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const PAGE = 200;
const MAX_PAGES = 6;

const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => (typeof v === 'string' ? v : v?.['#text'] ?? '').replace(/\s+/g, ' ').trim();
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-T:]/g, '');

export function arxivQuery(cfg: { categories: string[]; keyword_categories: string[]; keywords: string[] }, from: Date, to: Date): string {
  const cats = cfg.categories.map((c) => `cat:${c}`).join(' OR ');
  const kwCats = cfg.keyword_categories.map((c) => `cat:${c}`).join(' OR ');
  const kws = cfg.keywords.map((k) => `abs:"${k}"`).join(' OR ');
  return `((${cats}) OR ((${kwCats}) AND (${kws}))) AND submittedDate:[${stamp(from)} TO ${stamp(to)}]`;
}

export const arxiv: Collector = async ({ source, state, log }) => {
  const firstRun = !state.since;
  const now = new Date();
  // Announcements trail submission by a day or two; overlap and let dedupe absorb it.
  const from = firstRun ? new Date(now.getTime() - (source.config.backfill_days ?? 3) * 86400_000) : new Date(Date.parse(state.since) - 3 * 86400_000);
  const query = arxivQuery(source.config as any, from, now);

  const items: RawInput[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&start=${page * PAGE}&max_results=${PAGE}`;
    const res = await getText(url);
    if (res.status !== 200) break;
    const entries = list<any>(parser.parse(res.data).feed?.entry);
    for (const e of entries) {
      const id = text(e.id).replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
      if (!id) continue;
      items.push({
        external_id: id,
        url: `https://arxiv.org/abs/${id}`,
        published_at: new Date(text(e.published)),
        backfill: firstRun,
        payload: {
          id,
          title: text(e.title),
          summary: text(e.summary),
          comment: text(e['arxiv:comment']) || null,
          authors: list<any>(e.author).map((a) => text(a.name)),
          categories: list<any>(e.category).map((c) => c['@term']),
          primary_category: e['arxiv:primary_category']?.['@term'] ?? null,
        },
      });
    }
    if (entries.length < PAGE) break;
    await pause(3100);
  }
  state.since = now.toISOString();
  log(`${items.length} papers`);
  return items;
};
