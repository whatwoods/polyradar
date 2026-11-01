// Bluesky via Jetstream (PLAN §4.1): the whole public post stream as JSON
// over a WebSocket, filtered here by keyword and seed accounts. Matches are
// flushed every few seconds; the cursor lets a restart resume where it left off.
import { db } from '@polyradar/db';
import type { RawInput, SourceRow } from '../collectors/types.ts';
import { recordError, storeRun } from '../poll.ts';

const ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
export const FLUSH_MS = 30_000;
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

export type OnInserted = (ids: number[]) => Promise<void>;

/**
 * One connection to Jetstream for a source. The owner decides when to flush
 * and whether to reconnect: the CLI on timers, the Durable Object on alarms.
 */
export class JetstreamListener {
  readonly sourceId: number;
  private state: Record<string, any>;
  private match: (s: string) => boolean;
  private dids: Set<string>;
  private skipReplies: boolean;
  private buffer: RawInput[] = [];
  private lastUs: number | null;
  private seen = 0;
  private ws: WebSocket | null = null;
  open = false;
  onClose: (() => void) | null = null;

  constructor(readonly source: SourceRow, private onInserted: OnInserted, private log: (l: string) => void = console.log) {
    this.sourceId = source.id;
    this.state = structuredClone(source.state);
    this.match = keywordMatcher(source.config.keywords ?? []);
    this.dids = new Set<string>(source.config.dids ?? []);
    this.skipReplies = source.config.skip_replies ?? true;
    this.lastUs = this.state.cursor ?? null;
  }

  connect(): void {
    const { slug } = this.source;
    const resume = this.lastUs && Date.now() * 1000 - this.lastUs < MAX_REPLAY_US ? `&cursor=${this.lastUs - 5e6}` : '';
    const ws = new WebSocket(ENDPOINT + resume);
    this.ws = ws;
    ws.addEventListener('open', () => { this.open = true; this.log(`[${slug}] connected${resume ? ' (resumed)' : ''}`); });
    ws.addEventListener('message', (msg) => this.onMessage(String(msg.data)));
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.open = false;
      this.ws = null;
      this.onClose?.();
    });
  }

  /** Connected or connecting. */
  get active(): boolean { return this.ws !== null; }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    ws?.close();
  }

  private onMessage(data: string): void {
    let ev: JetEvent;
    try { ev = JSON.parse(data); } catch { return; }
    this.lastUs = ev.time_us;
    const c = ev.commit;
    if (ev.kind !== 'commit' || c?.operation !== 'create' || !c.record) return;
    this.seen++;
    const p = c.record;
    if (this.skipReplies && p.reply && !this.dids.has(ev.did)) return;
    const links = postLinks(p);
    const hay = `${p.text ?? ''} ${links.join(' ')} ${p.embed?.external?.title ?? ''}`;
    if (!this.dids.has(ev.did) && !this.match(hay)) return;
    this.buffer.push({
      external_id: `${ev.did}/${c.rkey}`,
      url: `https://bsky.app/profile/${ev.did}/post/${c.rkey}`,
      published_at: p.createdAt ? new Date(p.createdAt) : new Date(ev.time_us / 1000),
      payload: { did: ev.did, text: p.text ?? '', langs: p.langs ?? [], links, embed_title: p.embed?.external?.title ?? null, embed_description: p.embed?.external?.description ?? null },
    });
  }

  /** Stores buffered matches and the cursor, then hands new raw_item ids to the owner. */
  async flush(): Promise<number[]> {
    const items = this.buffer;
    this.buffer = [];
    if (this.lastUs) this.state.cursor = this.lastUs;
    this.state.seen_last_flush = this.seen;
    this.seen = 0;
    const ids = await storeRun(this.sourceId, items, this.state);
    if (items.length) this.log(`[${this.source.slug}] ${items.length} matches, ${ids.length} new`);
    if (ids.length) await this.onInserted(ids);
    return ids;
  }
}

export async function loadStreamSource(slug: string): Promise<(SourceRow & { enabled: boolean }) | null> {
  const { rows } = await db().query<SourceRow & { enabled: boolean }>(
    'select id, slug, kind, config, state, interval_sec, last_success_at, enabled from source where slug = $1', [slug]);
  return rows[0] ?? null;
}

/** Local runs (`pnpm collect bluesky`): listen for a while, flushing on a timer. */
export async function runJetstream(slug: string, opts: { durationMs: number; onInserted: OnInserted; log?: (l: string) => void }): Promise<void> {
  const log = opts.log ?? console.log;
  const source = await loadStreamSource(slug);
  if (!source) throw new Error(`unknown source ${slug}`);
  const listener = new JetstreamListener(source, opts.onInserted, log);
  let stopping = false;
  let backoff = 1000;
  listener.onClose = () => {
    if (stopping) return;
    log(`[${slug}] disconnected, retrying in ${backoff / 1000}s`);
    setTimeout(() => listener.connect(), backoff);
    backoff = Math.min(backoff * 2, 60_000);
  };
  listener.connect();
  const flush = () => listener.flush().catch((err) => log(`[${slug}] flush failed: ${err instanceof Error ? err.message : err}`));
  const timer = setInterval(flush, FLUSH_MS);
  await new Promise((r) => setTimeout(r, opts.durationMs));
  stopping = true;
  clearInterval(timer);
  listener.close();
  await flush().catch((err) => recordError(source.id, err));
}
