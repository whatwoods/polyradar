// Hugging Face: Daily Papers (community-picked, upvotes as a heat signal) and
// newly created models under the 3D pipeline tags, with their model cards.
import { getJson, getText, HttpError, pause } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

interface DailyPaper {
  paper: { id: string; title: string; summary: string; upvotes: number; githubRepo?: string | null; projectPage?: string | null; ai_keywords?: string[]; authors: { name: string }[]; submittedOnDailyAt?: string; publishedAt: string };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export const hfPapers: Collector = async ({ source, state, log }) => {
  const firstRun = !state.through;
  const today = new Date();
  // Re-read the last two days: papers keep being added to a day after it starts.
  const start = firstRun ? new Date(today.getTime() - (source.config.backfill_days ?? 2) * 86400_000) : new Date(Date.parse(state.through) - 86400_000);
  const items: RawInput[] = [];
  for (let d = new Date(day(start)); d <= today; d = new Date(d.getTime() + 86400_000)) {
    const res = await getJson<DailyPaper[]>(`https://huggingface.co/api/daily_papers?date=${day(d)}&limit=100`);
    if (res.status !== 200) continue;
    for (const { paper: p } of res.data) {
      items.push({
        external_id: p.id,
        url: `https://huggingface.co/papers/${p.id}`,
        published_at: new Date(p.submittedOnDailyAt ?? p.publishedAt),
        backfill: firstRun,
        payload: {
          id: p.id, title: p.title, summary: p.summary, upvotes: p.upvotes, github: p.githubRepo ?? null,
          project_page: p.projectPage ?? null, keywords: p.ai_keywords ?? [], authors: p.authors.map((a) => a.name),
        },
      });
    }
    await pause(300);
  }
  state.through = day(today);
  log(`${items.length} papers`);
  return items;
};

interface Model { id: string; author?: string; createdAt: string; likes: number; downloads: number; pipeline_tag?: string; tags: string[]; library_name?: string }

export const hfModels: Collector = async ({ source, state, log, warn }) => {
  const firstRun = !state.since;
  const since = firstRun ? Date.now() - (source.config.backfill_days ?? 2) * 86400_000 : Date.parse(state.since) - 3600_000;
  const maxCards: number = source.config.max_cards ?? 60;
  const runStart = new Date().toISOString();
  const items: RawInput[] = [];
  for (const tag of source.config.pipeline_tags as string[]) {
    const res = await getJson<Model[]>(`https://huggingface.co/api/models?pipeline_tag=${tag}&sort=createdAt&direction=-1&limit=100&full=true`);
    if (res.status !== 200) continue;
    for (const m of res.data) {
      if (Date.parse(m.createdAt) < since) break;
      if (items.some((i) => i.external_id === m.id)) continue;
      let card: string | null = null;
      if (items.length < maxCards) {
        try {
          const r = await getText(`https://huggingface.co/${m.id}/raw/main/README.md`);
          if (r.status === 200) card = r.data.slice(0, 8000);
        } catch (err) {
          if (!(err instanceof HttpError && (err.status === 404 || err.status === 401))) warn(`${m.id}: ${err instanceof Error ? err.message : err}`);
        }
        await pause(200);
      }
      items.push({
        external_id: m.id,
        url: `https://huggingface.co/${m.id}`,
        published_at: new Date(m.createdAt),
        backfill: firstRun,
        payload: {
          id: m.id, author: m.author ?? m.id.split('/')[0], pipeline_tag: m.pipeline_tag ?? tag, library: m.library_name ?? null,
          likes: m.likes, downloads: m.downloads,
          license: m.tags.find((t) => t.startsWith('license:'))?.slice(8) ?? null,
          arxiv: m.tags.filter((t) => t.startsWith('arxiv:')).map((t) => t.slice(6)),
          base_models: m.tags.filter((t) => t.startsWith('base_model:')).map((t) => t.replace(/^base_model:(\w+:)?/, '')),
          card,
        },
      });
    }
  }
  state.since = runStart;
  log(`${items.length} models`);
  return items;
};
