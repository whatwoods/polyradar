// Discourse forums (PLAN §4.1). Demos are often posted as replies in old
// topics, so every bumped topic is opened and its new posts are collected.
import { getJson, pause } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

interface Topic {
  id: number; slug: string; title: string; highest_post_number: number; bumped_at: string;
  pinned: boolean; image_url: string | null; tags?: (string | { name: string })[];
}
interface Post {
  id: number; post_number: number; created_at: string; username: string; name: string | null;
  cooked: string; reply_to_post_number: number | null; like_count?: number;
}
interface TopicDetail { post_stream: { posts: Post[]; stream: number[] } }

const MAX_PAGES = 8;
const MAX_SEEN = 3000;

export const discourse: Collector = async ({ source, state, log }) => {
  const base: string = source.config.base;
  const wanted: string[] = source.config.categories ?? [];
  const backfillDays: number = source.config.backfill_days ?? 3;
  const firstRun = !state.cutoff;
  // Overlap the previous run by an hour; raw_item uniqueness absorbs repeats.
  const cutoff = firstRun ? Date.now() - backfillDays * 86400_000 : Date.parse(state.cutoff) - 3600_000;
  const seen: Record<string, number> = (state.seen ??= {});

  if (!state.categories) {
    const cats = await getJson<{ category_list: { categories: { id: number; slug: string }[] } }>(`${base}/categories.json`);
    if (cats.status !== 200) throw new Error('categories.json not modified on first fetch');
    state.categories = Object.fromEntries(cats.data.category_list.categories.map((c) => [c.slug, c.id]));
  }

  const items: RawInput[] = [];
  const runStart = new Date().toISOString();
  for (const cat of wanted) {
    const catId = state.categories[cat];
    if (catId == null) throw new Error(`unknown category ${cat}`);
    for (let page = 0; page < MAX_PAGES; page++) {
      const list = await getJson<{ topic_list: { topics: Topic[]; more_topics_url?: string } }>(
        `${base}/c/${cat}/${catId}/l/latest.json?page=${page}`);
      if (list.status !== 200) break;
      const topics = list.data.topic_list.topics;
      let older = false;
      for (const t of topics) {
        if (Date.parse(t.bumped_at) < cutoff) { if (!t.pinned) older = true; continue; }
        const known = seen[t.id] ?? 0;
        if (t.highest_post_number <= known) continue;
        const posts = await newPosts(base, t, known);
        for (const p of posts) {
          if (Date.parse(p.created_at) < cutoff) continue;
          items.push({
            external_id: `post:${p.id}`,
            url: p.post_number === 1 ? `${base}/t/${t.slug}/${t.id}` : `${base}/t/${t.slug}/${t.id}/${p.post_number}`,
            published_at: new Date(p.created_at),
            backfill: firstRun,
            payload: {
              topic_id: t.id, topic_slug: t.slug, topic_title: t.title, topic_url: `${base}/t/${t.slug}/${t.id}`,
              category: cat, post_number: p.post_number, reply_to: p.reply_to_post_number,
              username: p.username, name: p.name, cooked: p.cooked, like_count: p.like_count ?? 0,
              image_url: p.post_number === 1 ? t.image_url : null,
              tags: (t.tags ?? []).map((x) => (typeof x === 'string' ? x : x.name)),
            },
          });
        }
        seen[t.id] = t.highest_post_number;
        await pause(250);
      }
      if (older || !list.data.topic_list.more_topics_url) break;
    }
  }

  // Forget the oldest topics so state stays small.
  const ids = Object.keys(seen).map(Number).sort((a, b) => a - b);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SEEN))) delete seen[id];
  state.cutoff = runStart;
  log(`${items.length} posts`);
  return items;
};

async function newPosts(base: string, t: Topic, known: number): Promise<Post[]> {
  const res = await getJson<TopicDetail>(`${base}/t/${t.id}.json`);
  if (res.status !== 200) return [];
  const { posts, stream } = res.data.post_stream;
  const loaded = new Set(posts.map((p) => p.id));
  // The topic payload carries the first ~20 posts; fetch the tail by id.
  const tailCount = Math.min(stream.length, t.highest_post_number - known);
  const missing = stream.slice(-tailCount).filter((id) => !loaded.has(id));
  const all = [...posts];
  for (let i = 0; i < missing.length; i += 20) {
    const q = missing.slice(i, i + 20).map((id) => `post_ids[]=${id}`).join('&');
    const more = await getJson<{ post_stream: { posts: Post[] } }>(`${base}/t/${t.id}/posts.json?${q}`);
    if (more.status === 200) all.push(...more.data.post_stream.posts);
    await pause(250);
  }
  return all.filter((p) => p.post_number > known);
}
