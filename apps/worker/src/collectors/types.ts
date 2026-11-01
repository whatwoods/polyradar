export interface RawInput {
  external_id: string;
  url: string | null;
  published_at: Date | null;
  payload: Record<string, unknown>;
  /** History picked up when a target is first seen; kept, but not news. */
  backfill?: boolean;
}

export interface SourceRow {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, any>;
  state: Record<string, any>;
  interval_sec: number;
  last_success_at: Date | null;
}

export interface CollectContext {
  source: SourceRow;
  /** Mutable copy of source.state; saved only when the run succeeds. */
  state: Record<string, any>;
  /** Tracked keys of one type from entity_key (github repos, npm packages). */
  trackedKeys: (type: 'github' | 'npm') => Promise<string[]>;
  log: (line: string) => void;
  /** Per-target failures that should not abort the whole run. */
  warn: (line: string) => void;
}

export type Collector = (ctx: CollectContext) => Promise<RawInput[]>;
