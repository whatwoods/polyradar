// Page-level data helpers on top of the shared query layer.
import { db } from '@polyradar/db';
import type { MapEntity } from '@/app/components/DomainMap';

export async function mapEntities(radarSlugs: Set<string>, showcaseSlugs: Set<string>): Promise<MapEntity[]> {
  const { rows } = await db().query<{ slug: string; name: string; top: string }>(
    `select distinct on (e.id) e.slug, e.name, split_part(c.slug, '/', 1) as top
     from entity e join entity_capability ec on ec.entity_id = e.id join capability c on c.id = ec.capability_id
     where e.status <> 'archived'
     order by e.id, c.slug`,
  );
  return rows.map((r) => ({
    ...r,
    mark: radarSlugs.has(r.slug) ? 'radar' : showcaseSlugs.has(r.slug) ? 'showcase' : null,
  }));
}

export async function insightsFor(slugs: string[]): Promise<Map<string, { claim: string; level: string; source: string }>> {
  const { rows } = await db().query<{ slug: string; claim_zh: string | null; claim_en: string; evidence_level: string }>(
    `select distinct on (e.slug) e.slug, i.claim_zh, i.claim_en, i.evidence_level
     from insight i join entity e on e.id = any(i.entity_ids) where e.slug = any($1) order by e.slug, i.id`,
    [slugs],
  );
  return new Map(rows.map((r) => [r.slug, { claim: r.claim_zh ?? r.claim_en, level: r.evidence_level, source: '原帖自述' }]));
}

export async function coreLibraries(): Promise<{ name: string; slug: string; version: string | null; breaking: number }[]> {
  const { rows } = await db().query(
    `select e.name, e.slug,
            (select v.version from api_version v where v.package = k.key order by v.seq desc limit 1) as version,
            (select count(*)::int from api_change c where c.package = k.key and c.kind = 'removed'
               and c.to_version = (select v.version from api_version v where v.package = k.key order by v.seq desc limit 1)) as breaking
     from entity e join entity_key k on k.entity_id = e.id and k.key_type = 'npm'
     where e.type = 'library' and e.importance >= 0.7 order by e.importance desc`,
  );
  return rows;
}
