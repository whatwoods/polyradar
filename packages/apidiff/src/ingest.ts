// Backfills or updates the API snapshot and change log for a tracked package.
//   pnpm apidiff            -> three, all minors since fromMinor
//   pnpm apidiff three 180  -> three, minors since 180
import semver from 'semver';
import { closeDb, db } from '@polyradar/db';
import { upsertEvidence } from '@polyradar/db/facts';
import { diffApi } from './diff.ts';
import { extractApi, type ApiSymbol } from './extract.ts';
import { packument, unpack } from './npm.ts';
import { PACKAGES } from './packages.ts';

const [name = 'three', fromArg] = process.argv.slice(2);
const pkg = PACKAGES[name];
if (!pkg) throw new Error(`untracked package: ${name}`);
const fromMinor = fromArg ? Number(fromArg) : pkg.fromMinor;

const types = await packument(pkg.typesPackage);
const runtime = await packument(pkg.name);

// Latest stable patch of each minor, oldest first.
const byMinor = new Map<number, string>();
for (const v of Object.keys(types.versions)) {
  const sv = semver.parse(v);
  if (!sv || sv.prerelease.length || sv.minor < fromMinor) continue;
  const cur = byMinor.get(sv.minor);
  if (!cur || semver.gt(v, cur)) byMinor.set(sv.minor, v);
}
const versions = [...byMinor.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
console.log(`${pkg.typesPackage}: ${versions.length} versions (${versions[0]} … ${versions.at(-1)})`);

const pool = db();
const entity = await pool.query<{ id: number }>(
  `select entity_id as id from entity_key where key_type = 'npm' and key = $1`,
  [pkg.name],
);
const entityId = entity.rows[0]?.id;

// Seed the diff with the snapshot just before the requested range, if stored.
let prev: ApiSymbol[] | null = null;
const before = await pool.query<{ version: string }>(
  'select version from api_version where package = $1 and seq < $2 order by seq desc limit 1',
  [pkg.name, fromMinor],
);
if (before.rows[0]) {
  const { rows } = await pool.query<ApiSymbol>(
    'select symbol, kind, signature, deprecated from api_symbol where package = $1 and version = $2',
    [pkg.name, before.rows[0].version],
  );
  prev = rows;
}
let prevLabel = before.rows[0]?.version ?? null;

for (const version of versions) {
  const label = pkg.label(version);
  const t0 = Date.now();
  const dir = await unpack(pkg.typesPackage, version, types.versions[version]!.dist.tarball);
  const api = extractApi(dir, pkg.entries);
  const minor = semver.minor(version);
  const runtimeVersion = `0.${minor}.0`;
  const releasedAt = runtime.time[runtimeVersion] ?? types.time[version] ?? null;

  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `insert into api_version (package, version, seq, label, released_at) values ($1, $2, $3, $2, $4)
       on conflict (package, version) do update set released_at = excluded.released_at`,
      [pkg.name, label, minor, releasedAt],
    );
    await c.query('delete from api_symbol where package = $1 and version = $2', [pkg.name, label]);
    await c.query(
      `insert into api_symbol (package, version, symbol, kind, signature, deprecated)
       select $1, $2, s.symbol, s.kind, s.signature, s.deprecated
       from jsonb_to_recordset($3::jsonb) as s(symbol text, kind text, signature text, deprecated text)`,
      [pkg.name, label, JSON.stringify(api)],
    );

    let changeCount = 0;
    if (prev) {
      const evidenceId = await upsertEvidence(c, `https://www.npmjs.com/package/${pkg.typesPackage}/v/${version}`);
      await c.query('delete from api_change where package = $1 and to_version = $2 and method = $3', [pkg.name, label, 'dts_diff']);
      const changes = diffApi(prev, api);
      changeCount = changes.length;
      await c.query(
        `insert into api_change (package, symbol, kind, from_version, to_version, before_sig, after_sig, migration_md, method, evidence_id)
         select $1, ch.symbol, ch.kind, $2, $3, ch."beforeSig", ch."afterSig", ch.migration, 'dts_diff', $4
         from jsonb_to_recordset($5::jsonb) as ch(symbol text, kind text, "beforeSig" text, "afterSig" text, migration text)`,
        [pkg.name, prevLabel, label, evidenceId, JSON.stringify(changes)],
      );
    }
    if (entityId != null) {
      await c.query(
        `insert into release (entity_id, version, released_at, source_url) values ($1, $2, $3, $4)
         on conflict (entity_id, version) do nothing`,
        [entityId, label, releasedAt, `https://github.com/mrdoob/three.js/releases/tag/${label}`],
      );
    }
    await c.query('commit');
    console.log(`${label}  ${api.length} symbols  ${changeCount} changes  ${Date.now() - t0}ms`);
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
  prev = api;
  prevLabel = label;
}
await closeDb();
