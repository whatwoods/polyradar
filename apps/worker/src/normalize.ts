// RawItem → Signal (PLAN §4.2, §7.3): canonical keys, deterministic entity
// resolution, rule relevance. Releases of tracked entities are deterministic
// facts and are published directly: release row, latest_version, event.
import semver from 'semver';
import { db, type PoolClient } from '@polyradar/db';
import { upsertEvidence, writeFact } from '@polyradar/db/facts';
import { keysFromUrl, keyString, type CanonicalKey } from '@polyradar/db/keys';
import { PACKAGES } from '@polyradar/apidiff/packages';
import { detectLang, hrefs, keywordRelevance, paperRelevance, stripHtml } from './text.ts';

export type Enqueue = (task: 'apidiff', payload: { package: string; fromMinor: number }) => Promise<void>;

interface Raw {
  id: string; external_id: string; url: string | null; published_at: Date | null; fetched_at: Date;
  payload: Record<string, any>; backfill: boolean; source_kind: string; source_slug: string; source_config: Record<string, any>;
}

interface Draft {
  kind: 'release' | 'post' | 'paper' | 'model_upload';
  title: string;
  text: string;
  urls: string[];
  /** Keys that identify the item itself (package, repo, topic); win over keys of links inside it. */
  native: CanonicalKey[];
  linked: CanonicalKey[];
  relevance: number;
  release?: { version: string; prerelease: boolean; notes: string | null; url: string; npm?: string };
  meta?: { stars: number; license: string | null };
}

export interface NormalizeStats { signals: number; matched: number; releases: number; events: number; /** Post, paper and model signals to triage next. */ triageIds: number[] }

export async function normalize(ids: number[], enqueue: Enqueue): Promise<NormalizeStats> {
  const stats: NormalizeStats = { signals: 0, matched: 0, releases: 0, events: 0, triageIds: [] };
  if (!ids.length) return stats;
  const { rows } = await db().query<Raw>(
    `select r.id, r.external_id, r.url, r.published_at, r.fetched_at, r.payload, r.backfill,
            s.kind as source_kind, s.slug as source_slug, s.config as source_config
     from raw_item r join source s on s.id = r.source_id
     where r.id = any($1) order by r.published_at nulls last, r.id`,
    [ids],
  );
  for (const raw of rows) {
    const c = await db().connect();
    try {
      await c.query('begin');
      await normalizeOne(c, raw, enqueue, stats);
      await c.query('commit');
    } catch (err) {
      await c.query('rollback');
      throw new Error(`normalize raw_item ${raw.id}: ${err instanceof Error ? err.message : err}`, { cause: err });
    } finally {
      c.release();
    }
  }
  return stats;
}

function draft(raw: Raw): Draft | null {
  const p = raw.payload;
  // Only the first link counts toward resolution: showcase posts lead with
  // their own demo, while later links are mostly "built with" mentions.
  const linkKeys = (urls: string[]) => (urls[0] && !isReference(urls[0]) ? keysFromUrl(urls[0]) : []);
  switch (raw.source_kind) {
    case 'npm':
      return {
        kind: 'release', title: `${p.name} ${p.version}`, text: '', urls: [raw.url!],
        native: [{ type: 'npm', key: p.name }], linked: [], relevance: 1,
        release: { version: p.version, prerelease: semver.prerelease(p.version) != null, notes: null, url: raw.url!, npm: p.name },
      };
    case 'github_repo': {
      const native: CanonicalKey[] = [{ type: 'github', key: String(p.repo).toLowerCase() }];
      if (p.type === 'meta') return { kind: 'release', title: p.repo, text: '', urls: [], native, linked: [], relevance: 1, meta: { stars: p.stars, license: p.license } };
      return {
        kind: 'release', title: `${p.repo} ${p.name || p.tag}`, text: p.body ?? '', urls: [raw.url!],
        native, linked: [], relevance: 1,
        release: { version: p.tag, prerelease: !!p.prerelease, notes: p.body, url: raw.url! },
      };
    }
    case 'discourse': {
      const base = new URL(raw.source_config.base).hostname;
      const links = hrefs(p.cooked).filter((h) => new URL(h).hostname !== base && !isMedia(h));
      const text = stripHtml(p.cooked);
      const showcase = p.category === 'showcase';
      return {
        kind: 'post',
        title: p.post_number === 1 ? p.topic_title : `${p.topic_title} #${p.post_number}`,
        text, urls: [raw.url!, ...links],
        // A reply is its own item; the topic key only identifies the opening post.
        native: [...keysFromUrl(raw.url!), ...(p.post_number === 1 ? keysFromUrl(p.topic_url) : [])],
        linked: linkKeys(links),
        relevance: Math.max(showcase ? 0.6 : 0.4, keywordRelevance(`${p.topic_title}\n${text}`)),
      };
    }
    case 'hn': {
      const urls = [p.url, p.discussion].filter(Boolean) as string[];
      return {
        kind: 'post', title: p.title, text: p.text ? stripHtml(p.text) : '', urls,
        native: p.url ? keysFromUrl(p.url) : [], linked: [],
        relevance: keywordRelevance(p.title),
      };
    }
    case 'rss':
    case 'reddit': {
      const links = hrefs(p.html ?? '').filter((h) => !isMedia(h));
      const text = stripHtml(p.html ?? '');
      // Reddit wraps the submitted link in the entry body; the entry link is the thread.
      const subject = raw.source_kind === 'reddit' ? links.find((h) => !/reddit\.com|redd\.it/.test(h)) : p.link;
      return {
        kind: 'post', title: decodeTitle(p.title), text, urls: [p.link, ...links].filter(Boolean),
        native: subject ? keysFromUrl(subject) : [], linked: linkKeys(links),
        relevance: Math.max(raw.source_kind === 'reddit' ? 0.4 : 0.3, keywordRelevance(`${p.title}\n${text}`)),
      };
    }
    case 'arxiv': {
      const links = [...`${p.comment ?? ''} ${p.summary}`.matchAll(/https?:\/\/[^\s,;)]+[^\s,;.)]/g)].map((m) => m[0]);
      const graphics = p.primary_category === 'cs.GR';
      return {
        kind: 'paper', title: p.title, text: [p.summary, p.comment].filter(Boolean).join('\n\n'), urls: [raw.url!, ...links],
        native: [{ type: 'arxiv', key: p.id }], linked: [],
        relevance: Math.max(graphics ? 0.4 : 0.25, keywordRelevance(`${p.title}\n${p.summary}`)),
      };
    }
    case 'hf_papers': {
      const urls = [raw.url!, `https://arxiv.org/abs/${p.id}`, p.github, p.project_page].filter(Boolean) as string[];
      return {
        kind: 'paper', title: p.title, text: `${p.summary}\n\nKeywords: ${(p.keywords ?? []).join(', ')}`, urls,
        native: [{ type: 'arxiv', key: p.id }], linked: [],
        relevance: paperRelevance(`${p.title}\n${p.summary}\n${(p.keywords ?? []).join(' ')}`),
      };
    }
    case 'hf_models': {
      const urls = [raw.url!, ...(p.arxiv as string[]).map((id) => `https://arxiv.org/abs/${id}`)];
      // A model without a card says nothing we could index.
      return {
        kind: 'model_upload', title: p.id, text: p.card ?? '', urls,
        native: [{ type: 'hf', key: String(p.id).toLowerCase() }], linked: [],
        relevance: p.card ? Math.max(0.4, keywordRelevance(p.card)) : 0.1,
      };
    }
    case 'bluesky': {
      const links = (p.links as string[]).filter((h) => !isMedia(h));
      const text = [p.text, p.embed_title, p.embed_description].filter(Boolean).join('\n');
      return {
        kind: 'post', title: String(p.text || p.embed_title || '').split('\n')[0]!.slice(0, 140) || '(no text)', text, urls: [raw.url!, ...links],
        native: [], linked: linkKeys(links),
        relevance: Math.max(0.3, keywordRelevance(text)),
      };
    }
    default:
      return null;
  }
}

const isMedia = (u: string) => /\/uploads\/|\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)(\?|$)/i.test(u);
/** Issue, PR, commit or file links point at a detail of a repo, not at what the post is about. */
const isReference = (u: string) => /github\.com\/[^/]+\/[^/]+\/(issues|pull|blob|tree|commit|discussions|compare)\b/i.test(u);

const decodeTitle = (t: string) => stripHtml(t ?? '');

async function resolve(c: PoolClient, d: Draft): Promise<number | null> {
  for (const keys of [d.native, d.linked]) {
    if (!keys.length) continue;
    const { rows } = await c.query<{ entity_id: number; k: string }>(
      `select entity_id, key_type || ':' || key as k from entity_key where key_type || ':' || key = any($1)`,
      [keys.map(keyString)],
    );
    if (!rows.length) continue;
    // Several tracked entities linked: the first link in reading order wins.
    const order = keys.map(keyString);
    rows.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
    return rows[0]!.entity_id;
  }
  return null;
}

async function normalizeOne(c: PoolClient, raw: Raw, enqueue: Enqueue, stats: NormalizeStats): Promise<void> {
  const d = draft(raw);
  if (!d) return;
  const entityId = await resolve(c, d);
  const at = raw.published_at ?? raw.fetched_at;

  if (d.meta) {
    if (entityId == null) return;
    const evidenceId = await upsertEvidence(c, raw.url!);
    await writeFact(c, { entityId, attribute: 'stars', value: d.meta.stars, at: raw.fetched_at, method: 'api', evidenceId, quiet: true, ignoreStale: true });
    await writeFact(c, { entityId, attribute: 'license_declared', value: d.meta.license != null, at: raw.fetched_at, method: 'api', evidenceId, ignoreStale: true });
    if (d.meta.license) await writeFact(c, { entityId, attribute: 'license_spdx', value: d.meta.license, at: raw.fetched_at, method: 'api', evidenceId, ignoreStale: true });
    return;
  }

  const keys = [...d.native, ...d.linked];
  const sig = await c.query<{ id: string }>(
    `insert into signal (raw_item_id, kind, title, text, lang, urls, canonical_keys, relevance, entity_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (raw_item_id) do update set kind = excluded.kind, title = excluded.title, text = excluded.text, lang = excluded.lang,
       urls = excluded.urls, canonical_keys = excluded.canonical_keys, relevance = excluded.relevance, entity_id = excluded.entity_id
     returning id`,
    [raw.id, d.kind, d.title.slice(0, 500), d.text.slice(0, 8000), detectLang(`${d.title}\n${d.text}`), [...new Set(d.urls)],
     [...new Set(keys.map(keyString))], entityId != null ? Math.max(d.relevance, 0.8) : d.relevance, entityId],
  );
  stats.signals++;
  if (d.kind !== 'release') stats.triageIds.push(Number(sig.rows[0]!.id));
  if (entityId == null) return;
  stats.matched++;
  await c.query('update entity set last_activity_at = greatest(last_activity_at, $2) where id = $1', [entityId, at]);
  if (!d.release) return;

  const eventId = await applyRelease(c, entityId, d.release, at, raw.backfill, enqueue, stats);
  if (!eventId) return;
  await c.query('update signal set event_id = $2 where id = $1', [sig.rows[0]!.id, eventId]);
  // Counted from links rather than incremented, so re-normalizing is idempotent.
  await c.query(
    `update event set (signal_count, source_diversity) = (
       select count(*), count(distinct r.source_id) from signal g join raw_item r on r.id = g.raw_item_id where g.event_id = $1)
     where id = $1`, [eventId]);
}

/** Tag or npm version → the label the project itself uses (three: r187). */
export function releaseLabel(raw: string, entityNpm: string | null): string {
  let v = raw.replace(/^.*@(?=v?\d)/, '').replace(/^v(?=\d)/, '');
  const tracked = entityNpm ? PACKAGES[entityNpm] : undefined;
  if (tracked && /^0\.\d+\.\d+$/.test(v)) {
    const patch = v.split('.')[2];
    v = tracked.label(v) + (patch === '0' ? '' : `.${patch}`);
  }
  return v;
}

/** Comparable semver for a tag, npm version or project label (r187 → 0.187.0). */
function toSemver(v: string): semver.SemVer | null {
  const r = /^r(\d+)(?:\.(\d+))?$/.exec(v);
  return semver.coerce(r ? `0.${r[1]}.${r[2] ?? 0}` : v.replace(/^.*@(?=v?\d)/, ''));
}

function bump(prev: string | null, next: string): 'major' | 'minor' | 'patch' | null {
  const a = prev ? toSemver(prev) : null;
  const b = toSemver(next);
  if (!a || !b || !semver.gt(b, a)) return null;
  // 0.x: a minor is a breaking-capable release (three, @types/three)
  const d = semver.diff(a, b);
  if (d === 'major' || (d === 'minor' && b.major === 0)) return b.major === 0 ? 'minor' : 'major';
  return d === 'minor' ? 'minor' : 'patch';
}

// Decision value for a release (PLAN §3.6): bigger bumps of more important
// entities matter more. Patches of anything but the core stay below the radar line.
const DECISION = { major: [0.4, 0.5], minor: [0.15, 0.45], patch: [0.05, 0.3] } as const;

async function applyRelease(
  c: PoolClient, entityId: number, rel: NonNullable<Draft['release']>, at: Date, backfill: boolean, enqueue: Enqueue, stats: NormalizeStats,
): Promise<string | null> {
  const ent = await c.query<{ name: string; importance: number; npm: string | null }>(
    `select e.name, e.importance, (select key from entity_key where entity_id = e.id and key_type = 'npm' limit 1) as npm
     from entity e where e.id = $1`, [entityId]);
  const e = ent.rows[0]!;
  const label = releaseLabel(rel.version, e.npm);
  const isGithub = rel.url.startsWith('https://github.com/');
  // npm is the version authority when there is one; a repo tag that doesn't
  // map onto it (three-ts-types tags r187 for @types/three 0.187.x) stays a signal.
  if (isGithub && e.npm && !PACKAGES[e.npm] && !semver.valid(label)) return null;

  await c.query(
    `insert into release (entity_id, version, semver, released_at, notes_md, source_url, is_prerelease)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (entity_id, version) do update set
       semver = coalesce(release.semver, excluded.semver),
       released_at = least(release.released_at, excluded.released_at),
       notes_md = coalesce(release.notes_md, excluded.notes_md),
       source_url = case when $8 then excluded.source_url else coalesce(release.source_url, excluded.source_url) end`,
    [entityId, label, JSON.stringify({ raw: rel.version }), at, rel.notes, rel.url, rel.prerelease, isGithub],
  );
  stats.releases++;
  if (rel.prerelease) return null;

  const evidenceId = await upsertEvidence(c, rel.url);
  await writeFact(c, { entityId, attribute: 'latest_version', value: label, at, method: 'api', evidenceId, quiet: true, ignoreStale: true });
  if (backfill) return null;

  const prev = await c.query<{ version: string; raw: string | null }>(
    `select version, semver->>'raw' as raw from release
     where entity_id = $1 and not is_prerelease and version <> $2 and released_at < $3
     order by released_at desc limit 1`, [entityId, label, at]);
  const kind = bump(prev.rows[0]?.raw ?? prev.rows[0]?.version ?? null, rel.version) ?? 'patch';
  const [base, weight] = DECISION[kind];
  const decision = Math.round((base + weight * e.importance) * 100) / 100;

  const ev = await c.query<{ id: string }>(
    `insert into event (entity_id, type, occurred_at, importance, decision_value, title, title_zh, source_url, payload, signal_count, source_diversity, cluster_key)
     values ($1, 'release', $2, $3, $4, $5, $6, $7, $8, 0, 0, $9)
     on conflict (cluster_key) do update set
       source_url = case when $10 then excluded.source_url else event.source_url end
     returning id`,
    [entityId, at, decision, decision, `${e.name} ${label}`, `${e.name} 发布 ${label}`, rel.url,
     JSON.stringify({ version: label, previous: prev.rows[0]?.version ?? null, bump: kind }), `release:${entityId}:${label}`, isGithub],
  );
  stats.events++;

  // A new three/@types/three version changes the public API: re-diff from that minor.
  const tracked = Object.values(PACKAGES).find((p) => p.name === rel.npm || p.typesPackage === rel.npm);
  if (tracked && rel.npm) {
    const minor = toSemver(rel.version)!.minor;
    await enqueue('apidiff', { package: tracked.name, fromMinor: minor });
  }
  return ev.rows[0]!.id;
}
