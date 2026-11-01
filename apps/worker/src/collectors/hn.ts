// Hacker News stories via the Algolia API, one query per keyword.
import { getJson, pause } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

interface Hit { objectID: string; title: string | null; url: string | null; author: string; points: number | null; num_comments: number | null; created_at_i: number; story_text: string | null }

export const hn: Collector = async ({ source, state, log }) => {
  const queries: string[] = source.config.queries ?? [];
  const firstRun = state.since == null;
  const since: number = firstRun ? Math.floor(Date.now() / 1000) - (source.config.backfill_days ?? 2) * 86400 : state.since - 7200;
  const runStart = Math.floor(Date.now() / 1000);
  const byId = new Map<string, RawInput>();
  for (const q of queries) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100&query=${encodeURIComponent(`"${q}"`)}&numericFilters=created_at_i>${since}`;
    const res = await getJson<{ hits: Hit[] }>(url);
    if (res.status !== 200) continue;
    for (const h of res.data.hits) {
      if (!h.title) continue;
      const prev = byId.get(h.objectID);
      if (prev) { (prev.payload.queries as string[]).push(q); continue; }
      byId.set(h.objectID, {
        external_id: h.objectID,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        published_at: new Date(h.created_at_i * 1000),
        backfill: firstRun,
        payload: {
          title: h.title, url: h.url, author: h.author, points: h.points ?? 0, comments: h.num_comments ?? 0,
          discussion: `https://news.ycombinator.com/item?id=${h.objectID}`, text: h.story_text, queries: [q],
        },
      });
    }
    await pause(200);
  }
  state.since = runStart;
  log(`${byId.size} stories`);
  return [...byId.values()];
};
