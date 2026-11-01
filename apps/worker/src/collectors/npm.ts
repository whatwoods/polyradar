// npm versions for tracked packages. Polls the tiny dist-tags document and
// only downloads the packument when a tag moved.
import { getJson } from '../http.ts';
import type { Collector, RawInput } from './types.ts';

interface Packument {
  name: string;
  time: Record<string, string>;
  versions: Record<string, { license?: string; deprecated?: string; repository?: { url?: string } | string }>;
  'dist-tags': Record<string, string>;
}

const BACKFILL_VERSIONS = 10;

export const npm: Collector = async ({ state, trackedKeys, log }) => {
  const pkgs: Record<string, { tags?: Record<string, string>; since?: string }> = (state.packages ??= {});
  const items: RawInput[] = [];
  for (const name of await trackedKeys('npm')) {
    const p = (pkgs[name] ??= {});
    const tags = await getJson<Record<string, string>>(`https://registry.npmjs.org/-/package/${name}/dist-tags`);
    if (tags.status !== 200) continue;
    if (p.tags && JSON.stringify(p.tags) === JSON.stringify(tags.data)) continue;

    const doc = await getJson<Packument>(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
    if (doc.status !== 200) continue;
    const firstSeen = !p.since;
    const published = Object.entries(doc.data.time)
      .filter(([v]) => v !== 'created' && v !== 'modified' && doc.data.versions[v])
      .sort((a, b) => a[1].localeCompare(b[1]));
    const fresh = firstSeen ? published.slice(-BACKFILL_VERSIONS) : published.filter(([, t]) => t > p.since!);
    for (const [version, time] of fresh) {
      const v = doc.data.versions[version]!;
      items.push({
        external_id: `${name}@${version}`,
        url: `https://www.npmjs.com/package/${name}/v/${version}`,
        published_at: new Date(time),
        backfill: firstSeen,
        payload: { name, version, license: v.license ?? null, deprecated: v.deprecated ?? null, dist_tags: doc.data['dist-tags'] },
      });
    }
    p.tags = tags.data;
    p.since = published.at(-1)?.[1] ?? p.since;
  }
  log(`${items.length} versions`);
  return items;
};
