import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffApi } from '../src/diff.ts';
import { parseThreeRevision } from '../src/packages.ts';

const sym = (symbol: string, signature: string, deprecated: string | null = null) => ({ symbol, kind: 'property', signature, deprecated });

test('reports added, removed, signature and deprecation changes', () => {
  const prev = [sym('A.x', 'number'), sym('A.y', 'string'), sym('A.z', 'boolean')];
  const next = [sym('A.x', 'number', 'Use A.w'), sym('A.y', 'number'), sym('A.w', 'number')];
  assert.deepEqual(
    diffApi(prev, next).map((c) => [c.symbol, c.kind]),
    [['A.w', 'added'], ['A.x', 'deprecated'], ['A.y', 'signature_changed'], ['A.z', 'removed']],
  );
});

test('removal carries the earlier deprecation note as migration', () => {
  const [change] = diffApi([sym('R.outputEncoding', 'TextureEncoding', 'Use outputColorSpace')], []);
  assert.equal(change?.kind, 'removed');
  assert.equal(change?.migration, 'Use outputColorSpace');
});

test('identical snapshots produce no changes', () => {
  assert.deepEqual(diffApi([sym('A', 'x')], [sym('A', 'x')]), []);
});

test('parses three revision spellings', () => {
  for (const s of ['r162', 'R162', '162', '0.162', '0.162.1']) assert.equal(parseThreeRevision(s), 162);
  assert.equal(parseThreeRevision('latest'), null);
});
