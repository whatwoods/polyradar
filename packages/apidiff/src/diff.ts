import type { ApiSymbol } from './extract.ts';

export type ChangeKind = 'added' | 'removed' | 'signature_changed' | 'deprecated';

export interface ApiChange {
  symbol: string;
  kind: ChangeKind;
  beforeSig: string | null;
  afterSig: string | null;
  /** For removals: the deprecation note the symbol carried before it went away. */
  migration: string | null;
}

/** Deterministic diff of two adjacent API snapshots. Renames are left to notes/human review. */
export function diffApi(prev: ApiSymbol[], next: ApiSymbol[]): ApiChange[] {
  const before = new Map(prev.map((s) => [s.symbol, s]));
  const after = new Map(next.map((s) => [s.symbol, s]));
  const changes: ApiChange[] = [];

  for (const [name, a] of after) {
    const b = before.get(name);
    if (!b) {
      changes.push({ symbol: name, kind: 'added', beforeSig: null, afterSig: a.signature, migration: null });
      continue;
    }
    if (b.signature !== a.signature) {
      changes.push({ symbol: name, kind: 'signature_changed', beforeSig: b.signature, afterSig: a.signature, migration: null });
    }
    if (!b.deprecated && a.deprecated) {
      changes.push({ symbol: name, kind: 'deprecated', beforeSig: b.signature, afterSig: a.signature, migration: a.deprecated });
    }
  }
  for (const [name, b] of before) {
    if (!after.has(name)) {
      changes.push({ symbol: name, kind: 'removed', beforeSig: b.signature, afterSig: null, migration: b.deprecated });
    }
  }
  return changes.sort((x, y) => x.symbol.localeCompare(y.symbol) || x.kind.localeCompare(y.kind));
}
