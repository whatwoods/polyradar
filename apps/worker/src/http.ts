// Polite HTTP for collectors: one UA, timeouts, conditional requests.
const UA = 'Polyradar/0.1 (web 3D intelligence index)';

export interface Cached { etag?: string; lastModified?: string }

export type Fetched<T> = { status: 304; cache: Cached } | { status: 200; data: T; cache: Cached };

export class HttpError extends Error {
  constructor(readonly url: string, readonly status: number, body: string) {
    super(`${status} ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}

async function request(url: string, init: { headers?: Record<string, string>; cache?: Cached; method?: string; body?: string }): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': UA, ...init.headers };
  if (init.cache?.etag) headers['if-none-match'] = init.cache.etag;
  if (init.cache?.lastModified) headers['if-modified-since'] = init.cache.lastModified;
  const res = await fetch(url, { method: init.method, body: init.body, headers, signal: AbortSignal.timeout(30_000) });
  if (res.status !== 304 && !res.ok) throw new HttpError(url, res.status, await res.text().catch(() => ''));
  return res;
}

function cacheOf(res: Response, prev?: Cached): Cached {
  return {
    etag: res.headers.get('etag') ?? prev?.etag,
    lastModified: res.headers.get('last-modified') ?? prev?.lastModified,
  };
}

export async function getJson<T>(url: string, opts: { headers?: Record<string, string>; cache?: Cached } = {}): Promise<Fetched<T>> {
  const res = await request(url, { headers: { accept: 'application/json', ...opts.headers }, cache: opts.cache });
  if (res.status === 304) return { status: 304, cache: opts.cache ?? {} };
  return { status: 200, data: (await res.json()) as T, cache: cacheOf(res, opts.cache) };
}

export async function getText(url: string, opts: { headers?: Record<string, string>; cache?: Cached } = {}): Promise<Fetched<string>> {
  const res = await request(url, { headers: opts.headers, cache: opts.cache });
  if (res.status === 304) return { status: 304, cache: opts.cache ?? {} };
  return { status: 200, data: await res.text(), cache: cacheOf(res, opts.cache) };
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json', ...headers } });
  return (await res.json()) as T;
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
