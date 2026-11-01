// GitHub releases and repo metadata for every tracked repo. Uses conditional
// requests; set GITHUB_TOKEN to lift the 60 req/h anonymous limit.
import { getJson, HttpError, type Cached } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

interface Release { id: number; tag_name: string; name: string | null; body: string | null; html_url: string; published_at: string | null; prerelease: boolean; draft: boolean }
interface Repo { full_name: string; stargazers_count: number; license: { spdx_id: string | null } | null; archived: boolean; pushed_at: string; html_url: string; description: string | null }

const META_EVERY_MS = 6 * 3600_000;

export const github: Collector = async ({ state, trackedKeys, log, warn }) => {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  const repos: Record<string, { releases?: Cached; metaAt?: string }> = (state.repos ??= {});

  const items: RawInput[] = [];
  for (const repo of await trackedKeys('github')) {
    const r = (repos[repo] ??= {});
    const firstSeen = !r.releases;
    try {
      const rel = await getJson<Release[]>(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers, cache: r.releases });
      r.releases = rel.cache;
      if (rel.status === 200) {
        for (const x of rel.data) {
          if (x.draft) continue;
          items.push({
            external_id: `release:${repo}:${x.tag_name}`,
            url: x.html_url,
            published_at: x.published_at ? new Date(x.published_at) : null,
            backfill: firstSeen,
            payload: { type: 'release', repo, tag: x.tag_name, name: x.name, body: x.body?.slice(0, 20_000) ?? null, prerelease: x.prerelease },
          });
        }
      }
      if (!r.metaAt || Date.now() - Date.parse(r.metaAt) > META_EVERY_MS) {
        const meta = await getJson<Repo>(`https://api.github.com/repos/${repo}`, { headers });
        if (meta.status === 200) {
          const m = meta.data;
          const license = m.license?.spdx_id && m.license.spdx_id !== 'NOASSERTION' ? m.license.spdx_id : null;
          // One raw item per distinct observation; unchanged metadata dedupes.
          items.push({
            external_id: `meta:${repo}:${m.stargazers_count}:${license ?? '-'}:${m.archived}`,
            url: m.html_url,
            published_at: null,
            payload: { type: 'meta', observed_at: new Date().toISOString(), repo, stars: m.stargazers_count, license, archived: m.archived, pushed_at: m.pushed_at, description: m.description },
          });
        }
        r.metaAt = new Date().toISOString();
      }
    } catch (err) {
      // A renamed or deleted repo must not stall the others.
      if (err instanceof HttpError && (err.status === 404 || err.status === 451)) warn(`${repo}: ${err.status}`);
      else throw err;
    }
  }
  log(`${items.length} items`);
  return items;
};
