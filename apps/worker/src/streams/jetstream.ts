// Bluesky via Jetstream (PLAN §4.1): the whole public post stream as JSON
// over a WebSocket, filtered here by keyword and seed accounts. Matches are
// flushed every few seconds; the cursor lets a restart resume where it left off.
import { db } from '@polyradar/db';
import type { RawInput, SourceRow } from '../collectors/types.ts';
import { recordError, storeRun } from '../poll.ts';

const ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
const FLUSH_MS = 30_000;
/** Older cursors are dropped: replaying hours of the full firehose is not worth it. */
const MAX_REPLAY_US = 15 * 60 * 1e6;

interface JetEvent {
  did: string; time_us: number; kind: string;
  commit?: { operation: string; collection: string; rkey: string; record?: Post };
}
interface Post {
  text?: string; createdAt?: string; langs?: string[]; reply?: unknown;
  facets?: { features?: { $type: string; uri?: string; tag?: string }[] }[];
  embed?: { $type: string; external?: { uri: string; title?: string; description?: string }; media?: { external?: { uri: string } } };
}

export function keywordMatcher(keywords: string[]): (s: string) => boolean {
  const esc = keywords.map((k) => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?'));
  const re = new RegExp(`(^|[^\\w])(${esc.join('|')})($|[^\\w])`, 'i');
  return (s) => re.test(s);
}

export function postLinks(p: Post): string[] {
  const out = new Set<string>();
  for (const f of p.facets ?? []) for (const x of f.features ?? []) if (x.uri) out.add(x.uri);
  const ext = p.embed?.external ?? p.embed?.media?.external;
  if (ext?.uri) out.add(ext.uri);
  return [...out];
}

export interface StreamHandle { stop: () => Promise<void>; done: Promise<void> }

/**
 * Runs until stop() (or for `durationMs` when given). `onInserted` receives the
 * raw_item ids of each flush, for the caller to queue normalization.
 */
export async function runJetstream(slug: string, opts: { durationMs?: number; onInserted: (ids: number[]) => Promise<void>; log?: (l: string) => void }): Promise<StreamHandle> {
  const log = opts.log ?? console.log;
  const { rows } = await db().query<SourceRow>('select id, slug, kind, config, state, interval_sec, last_success_at from source where slug = $1', [slug]);
  const source = rows[0];
  if (!source) throw new Error(`unknown source ${slug}`);
  const state = structuredClone(source.state);
  const match = keywordMatcher(source.config.keywords ?? []);
  const dids = new Set<string>(source.config.dids ?? []);
  const skipReplies: boolean = source.config.skip_replies ?? true;

  let buffer: RawInput[] = [];
  let lastUs: number | null = state.cursor ?? null;
  let seen = 0;
  let ws: WebSocket | null = null;
  let stopping = false;
  let backoff = 1000;

  const flush = async () => {
    const items = buffer;
    buffer = [];
    if (lastUs) state.cursor = lastUs;
    state.seen_last_flush = seen;
    seen = 0;
    try {
      const ids = await storeRun(source.id, items, state);
      if (items.length) log(`[${slug}] ${items.length} matches, ${ids.length} new`);
      if (ids.length) await opts.onInserted(ids);
    } catch (err) {
      log(`[${slug}] flush failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const connect = () => {
    const resume = lastUs && Date.now() * 1000 - lastUs < MAX_REPLAY_US ? `&cursor=${lastUs - 5e6}` : '';
    ws = new WebSocket(ENDPOINT + resume);
    ws.onopen = () => { backoff = 1000; log(`[${slug}] connected${resume ? ' (resumed)' : ''}`); };
    ws.onmessage = (msg) => {
      let ev: JetEvent;
      try { ev = JSON.parse(String(msg.data)); } catch { return; }
      lastUs = ev.time_us;
      const c = ev.commit;
      if (ev.kind !== 'commit' || c?.operation !== 'create' || !c.record) return;
      seen++;
      const p = c.record;
      if (skipReplies && p.reply && !dids.has(ev.did)) return;
      const links = postLinks(p);
      const hay = `${p.text ?? ''} ${links.join(' ')} ${p.embed?.external?.title ?? ''}`;
      if (!dids.has(ev.did) && !match(hay)) return;
      buffer.push({
        external_id: `${ev.did}/${c.rkey}`,
        url: `https://bsky.app/profile/${ev.did}/post/${c.rkey}`,
        published_at: p.createdAt ? new Date(p.createdAt) : new Date(ev.time_us / 1000),
        payload: { did: ev.did, text: p.text ?? '', langs: p.langs ?? [], links, embed_title: p.embed?.external?.title ?? null, embed_description: p.embed?.external?.description ?? null },
      });
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (stopping) return;
      log(`[${slug}] disconnected, retrying in ${backoff / 1000}s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    };
  };

  connect();
  const timer = setInterval(() => void flush(), FLUSH_MS);
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const stop = async () => {
    if (stopping) return done;
    stopping = true;
    clearInterval(timer);
    ws?.close();
    await flush();
    resolveDone();
  };
  if (opts.durationMs) setTimeout(() => void stop().catch((err) => recordError(source.id, err)), opts.durationMs);
  return { stop, done };
}
