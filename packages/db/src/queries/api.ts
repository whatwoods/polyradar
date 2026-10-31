// Read side of the API change log: "does X exist in version V, and if not, what replaces it?"
import { db } from '../index.ts';

export interface ApiVersion { version: string; seq: number; released_at: Date | null }

export interface SymbolHistoryEntry { kind: string; version: string; seq: number; migration: string | null; before: string | null; after: string | null }

export interface SymbolCheck {
  symbol: string;
  exists: boolean;
  inherited_from: string | null;
  kind: string | null;
  signature: string | null;
  deprecated: string | null;
  added_in: string | null;
  deprecated_in: string | null;
  removed_in: string | null;
  replacement: string | null;
  history: SymbolHistoryEntry[];
  evidence_url: string;
}

export interface CheckApiResult {
  package: string;
  version: string;
  latest: string;
  query: string;
  matches: SymbolCheck[];
}

export async function apiVersions(pkg: string): Promise<ApiVersion[]> {
  const { rows } = await db().query<ApiVersion>(
    'select version, seq, released_at from api_version where package = $1 order by seq',
    [pkg],
  );
  return rows;
}

/** "r162", "162", "0.162.1", "latest" → the snapshot at or just before that revision. */
export async function resolveVersion(pkg: string, input?: string | null): Promise<ApiVersion | null> {
  const m = input ? /^(?:r|0\.)?(\d{1,4})(?:\.\d+)?$/i.exec(input.trim()) : null;
  const { rows } = m
    ? await db().query<ApiVersion>(
        'select version, seq, released_at from api_version where package = $1 and seq <= $2 order by seq desc limit 1',
        [pkg, Number(m[1])],
      )
    : await db().query<ApiVersion>(
        'select version, seq, released_at from api_version where package = $1 order by seq desc limit 1',
        [pkg],
      );
  return rows[0] ?? null;
}

/**
 * Turns what a person or agent typed into symbol names we know. Accepts the
 * exact name, or `instance.member` style ("renderer.outputEncoding"), where the
 * prefix is matched against class names case-insensitively.
 */
export async function resolveSymbols(pkg: string, query: string, limit = 5): Promise<string[]> {
  const q = query.trim().replace(/^THREE\./, '').replace(/\(\)$/, '').replace(/\.prototype\./, '.');
  const exact = await db().query<{ symbol: string }>(
    'select 1 from api_symbol where package = $1 and symbol = $2 limit 1',
    [pkg, q],
  );
  if (exact.rowCount) return [q];

  const dot = q.lastIndexOf('.');
  const member = dot >= 0 ? q.slice(dot + 1) : q;
  const hint = dot >= 0 ? q.slice(0, dot).toLowerCase() : '';
  const { rows } = await db().query<{ symbol: string }>(
    `select symbol from (
       select distinct symbol from api_symbol
       where package = $1 and (symbol like '%.' || $2 or lower(symbol) = lower($3))
     ) s
     order by (case when $4 <> '' and lower(split_part(symbol, '.', 1)) = $4 then 0
                    when $4 <> '' and lower(split_part(symbol, '.', 1)) like '%' || $4 || '%' then 1
                    else 2 end),
              length(symbol), symbol
     limit $5`,
    [pkg, member, q, hint, limit],
  );
  return rows.map((r) => r.symbol);
}

const cleanLinks = (s: string | null): string | null =>
  s?.replace(/\{@link\s+([^\s}]+)(?:\s+[^}]*)?\}/g, '$1').replace(/\s+/g, ' ').trim() ?? null;

export async function symbolHistory(pkg: string, symbol: string): Promise<SymbolHistoryEntry[]> {
  const { rows } = await db().query<SymbolHistoryEntry>(
    `select c.kind, c.to_version as version, v.seq, c.migration_md as migration, c.before_sig as before, c.after_sig as after
     from api_change c join api_version v on v.package = c.package and v.version = c.to_version
     where c.package = $1 and c.symbol = $2 order by v.seq, c.kind`,
    [pkg, symbol],
  );
  return rows.map((r) => ({ ...r, migration: cleanLinks(r.migration) }));
}

async function symbolAt(pkg: string, version: string, symbol: string) {
  const { rows } = await db().query<{ kind: string; signature: string; deprecated: string | null }>(
    'select kind, signature, deprecated from api_symbol where package = $1 and version = $2 and symbol = $3',
    [pkg, version, symbol],
  );
  return rows[0] ?? null;
}

/** Follows `class X extends Y` signatures to find a member declared on an ancestor. */
async function findInherited(pkg: string, version: string, symbol: string) {
  const dot = symbol.indexOf('.');
  if (dot < 0) return null;
  let cls = symbol.slice(0, dot);
  const member = symbol.slice(dot + 1);
  for (let depth = 0; depth < 8; depth++) {
    const def = await symbolAt(pkg, version, cls);
    const parent = def && /^class \S+ extends ([A-Za-z0-9_$]+)/.exec(def.signature)?.[1];
    if (!parent) return null;
    const hit = await symbolAt(pkg, version, `${parent}.${member}`);
    if (hit) return { from: parent, ...hit };
    cls = parent;
  }
  return null;
}

export async function checkApi(pkg: string, query: string, versionInput?: string | null): Promise<CheckApiResult | null> {
  const [version, latest] = await Promise.all([resolveVersion(pkg, versionInput), resolveVersion(pkg)]);
  if (!version || !latest) return null;

  const matches: SymbolCheck[] = [];
  for (const symbol of await resolveSymbols(pkg, query)) {
    const history = await symbolHistory(pkg, symbol);
    const here = await symbolAt(pkg, version.version, symbol);
    const inherited = here ? null : await findInherited(pkg, version.version, symbol);
    const found = here ?? inherited;

    const last = (kind: string) => history.filter((h) => h.kind === kind && h.seq <= version.seq).at(-1) ?? null;
    const removed = here ? null : last('removed');
    const deprecated = last('deprecated');
    // Earliest snapshot containing the symbol (or, if only inherited here, the
    // ancestor's member): the first snapshot has no "added" rows to go by.
    const origin = inherited ? `${inherited.from}.${symbol.slice(symbol.indexOf('.') + 1)}` : symbol;
    const firstSeen = await db().query<{ version: string }>(
      `select s.version from api_symbol s join api_version v using (package, version)
       where s.package = $1 and s.symbol = $2 order by v.seq limit 1`,
      [pkg, origin],
    );
    const replacement = cleanLinks(found?.deprecated ?? null) ?? removed?.migration ?? deprecated?.migration ?? null;

    matches.push({
      symbol,
      exists: !!found,
      inherited_from: inherited?.from ?? null,
      kind: found?.kind ?? null,
      signature: found?.signature ?? null,
      deprecated: cleanLinks(found?.deprecated ?? null),
      added_in: firstSeen.rows[0]?.version ?? null,
      deprecated_in: deprecated?.version ?? null,
      removed_in: removed?.version ?? null,
      replacement,
      history,
      evidence_url: `https://www.npmjs.com/package/@types/${pkg}/v/0.${version.seq}.0`,
    });
  }
  return { package: pkg, version: version.version, latest: latest.version, query, matches };
}

export interface LifelineRow { symbol: string; added: number | null; deprecated: number | null; removed: number | null }

/** Compact add/deprecate/remove points per symbol, for the lifeline chart. */
export async function lifelines(pkg: string, symbols: string[]): Promise<LifelineRow[]> {
  const { rows } = await db().query<{ symbol: string; kind: string; seq: number }>(
    `select c.symbol, c.kind, v.seq from api_change c
     join api_version v on v.package = c.package and v.version = c.to_version
     where c.package = $1 and c.symbol = any($2) and c.kind in ('added','deprecated','removed')
     order by v.seq`,
    [pkg, symbols],
  );
  return symbols.map((symbol) => {
    const own = rows.filter((r) => r.symbol === symbol);
    const pick = (k: string) => own.filter((r) => r.kind === k).at(-1)?.seq ?? null;
    return { symbol, added: pick('added'), deprecated: pick('deprecated'), removed: pick('removed') };
  });
}

export interface ChangeRow { symbol: string; kind: string; to_version: string; before_sig: string | null; after_sig: string | null; migration: string | null }

export async function changesIn(pkg: string, version: string, kinds: string[] = ['removed', 'deprecated'], limit = 200): Promise<ChangeRow[]> {
  const { rows } = await db().query<ChangeRow>(
    `select symbol, kind, to_version, before_sig, after_sig, migration_md as migration
     from api_change where package = $1 and to_version = $2 and kind = any($3)
     order by kind, symbol limit $4`,
    [pkg, version, kinds, limit],
  );
  return rows.map((r) => ({ ...r, migration: cleanLinks(r.migration) }));
}
