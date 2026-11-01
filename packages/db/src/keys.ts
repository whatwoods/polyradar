// Canonical keys (PLAN §3.4): the deterministic first step of entity
// resolution. Shared by the seed loader and the signal normalizer so both
// sides of a lookup are spelled the same way.

export type KeyType = 'github' | 'npm' | 'pypi' | 'arxiv' | 'hf' | 'doi' | 'url';
export interface CanonicalKey { type: KeyType; key: string }

const TRACKING = /^(utm_\w+|ref|ref_src|fbclid|gclid|s|si|feature)$/i;
const GITHUB_RESERVED = new Set(['orgs', 'sponsors', 'features', 'topics', 'marketplace', 'settings', 'login', 'about', 'collections', 'search', 'trending', 'apps', 'notifications', 'pulls', 'issues']);

/** https, lowercase host without www, no hash, no tracking params, no trailing slash. */
export function normalizeUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  const s = u.toString();
  return u.pathname === '/' && !u.search ? s.slice(0, -1) : s;
}

/** Every canonical key a URL implies: the URL itself plus repo/package/paper ids. */
export function keysFromUrl(input: string): CanonicalKey[] {
  const norm = normalizeUrl(input);
  if (!norm) return [];
  const out: CanonicalKey[] = [{ type: 'url', key: norm }];
  const u = new URL(norm);
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const host = u.hostname;

  if (host === 'github.com' && parts.length >= 2 && !GITHUB_RESERVED.has(parts[0]!.toLowerCase())) {
    out.push({ type: 'github', key: `${parts[0]}/${parts[1]!.replace(/\.git$/, '')}`.toLowerCase() });
  } else if (host.endsWith('.github.io')) {
    // owner.github.io/repo/… is a Pages site of github.com/owner/repo
    const owner = host.slice(0, -'.github.io'.length);
    out.push({ type: 'github', key: (parts[0] ? `${owner}/${parts[0]}` : `${owner}/${owner}.github.io`).toLowerCase() });
  } else if (host === 'npmjs.com' && parts[0] === 'package' && parts[1]) {
    out.push({ type: 'npm', key: parts[1].startsWith('@') && parts[2] ? `${parts[1]}/${parts[2]}` : parts[1] });
  } else if (host === 'arxiv.org' && (parts[0] === 'abs' || parts[0] === 'pdf') && parts[1]) {
    out.push({ type: 'arxiv', key: parts[1].replace(/\.pdf$/, '').replace(/v\d+$/, '') });
  } else if (host === 'huggingface.co' && parts.length >= 2) {
    if (parts[0] === 'papers') out.push({ type: 'arxiv', key: parts[1]!.replace(/v\d+$/, '') });
    else if (parts[0] === 'spaces' || parts[0] === 'datasets') { if (parts[2]) out.push({ type: 'hf', key: `${parts[0]}/${parts[1]}/${parts[2]}`.toLowerCase() }); }
    else if (!['blog', 'docs', 'learn', 'models', 'organizations'].includes(parts[0]!)) out.push({ type: 'hf', key: `${parts[0]}/${parts[1]}`.toLowerCase() });
  } else if (host === 'doi.org' && parts.length >= 2) {
    out.push({ type: 'doi', key: parts.join('/').toLowerCase() });
  } else if (host === 'pypi.org' && parts[0] === 'project' && parts[1]) {
    out.push({ type: 'pypi', key: parts[1].toLowerCase() });
  }
  return out;
}

/** Form stored in entity_key and compared against: lowercase except npm names keep their (lowercase-only) spelling. */
export function canonicalKey(type: KeyType, key: string): string {
  if (type === 'url') return normalizeUrl(key) ?? key;
  return type === 'npm' ? key : key.toLowerCase();
}

export const keyString = (k: CanonicalKey) => `${k.type}:${k.key}`;
