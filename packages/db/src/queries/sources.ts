// Read side for the source health page (PLAN §7.1: silent staleness is the
// main failure mode of a collector system, so it gets its own page).
import { db } from '../index.ts';

export type SourceStatus = 'ok' | 'stale' | 'error' | 'pending' | 'disabled';

export interface SourceHealth {
  slug: string; kind: string; tier: string; interval_sec: number; enabled: boolean;
  last_success_at: Date | null; last_run_at: Date | null; last_error: string | null; last_error_at: Date | null;
  lag_p90_sec: number | null; items_24h: number; items_total: number; signals_relevant_24h: number;
  warnings: string[]; status: SourceStatus;
}

export async function sourceHealth(): Promise<SourceHealth[]> {
  const { rows } = await db().query<Omit<SourceHealth, 'status'>>(
    `select s.slug, s.kind, s.tier, s.interval_sec, s.enabled, s.last_success_at, s.last_run_at, s.last_error, s.last_error_at,
            s.lag_p90_sec, coalesce(s.state->'warnings', '[]') as warnings,
            (select count(*)::int from raw_item r where r.source_id = s.id and r.fetched_at > now() - interval '24 hours') as items_24h,
            (select count(*)::int from raw_item r where r.source_id = s.id) as items_total,
            (select count(*)::int from raw_item r join signal g on g.raw_item_id = r.id
             where r.source_id = s.id and r.published_at > now() - interval '24 hours' and g.relevance >= 0.5) as signals_relevant_24h
     from source s order by s.tier, s.slug`);
  const now = Date.now();
  return rows.map((r) => {
    // Stale: no success for three intervals (at least 30 minutes).
    const staleAfter = Math.max(3 * r.interval_sec, 1800) * 1000;
    const failedLast = r.last_error != null && (!r.last_success_at || (r.last_error_at && r.last_error_at > r.last_success_at));
    const status: SourceStatus = !r.enabled ? 'disabled'
      : failedLast ? 'error'
      : !r.last_success_at ? 'pending'
      : now - r.last_success_at.getTime() > staleAfter ? 'stale'
      : 'ok';
    return { ...r, status };
  });
}

export interface SignalRow {
  id: string; kind: string; title: string; url: string | null; published_at: Date | null; relevance: number | null;
  lang: string | null; source_slug: string; source_kind: string; entity_slug: string | null; entity_name: string | null;
}

export async function recentSignals(opts: { source?: string | null; minRelevance?: number; limit?: number } = {}): Promise<SignalRow[]> {
  const { rows } = await db().query<SignalRow>(
    `select g.id::text, g.kind, g.title, coalesce(g.urls[1], r.url) as url, r.published_at, g.relevance, g.lang,
            s.slug as source_slug, s.kind as source_kind, e.slug as entity_slug, e.name as entity_name
     from signal g join raw_item r on r.id = g.raw_item_id join source s on s.id = r.source_id
     left join entity e on e.id = g.entity_id
     where ($1::text is null or s.slug = $1) and coalesce(g.relevance, 0) >= $2
     order by r.published_at desc nulls last, g.id desc limit $3`,
    [opts.source ?? null, opts.minRelevance ?? 0, opts.limit ?? 50]);
  return rows;
}
