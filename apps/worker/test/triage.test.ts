import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteIn } from '../src/extract.ts';
import { slugify } from '../src/promote.ts';
import { checkSubject, decisionValue, leafCapabilities } from '../src/triage.ts';

test('subject must be one of the item links and not a forum or video host', () => {
  const urls = ['https://discourse.threejs.org/t/x/1', 'https://lo-th.github.io/landscape/', 'https://www.youtube.com/watch?v=1'];
  assert.equal(checkSubject('https://lo-th.github.io/landscape', urls), 'https://lo-th.github.io/landscape/');
  assert.equal(checkSubject('https://www.youtube.com/watch?v=1', urls), null);
  assert.equal(checkSubject('https://made-up.example.com', urls), null);
  assert.equal(checkSubject(null, urls), null);
});

test('capabilities keep the most specific nodes, at most three', () => {
  assert.deepEqual(leafCapabilities(['render', 'render/particles', 'render/particles/gpu-compute', 'procgen/city']), ['render/particles/gpu-compute', 'procgen/city']);
  assert.equal(leafCapabilities(['a', 'b', 'c', 'd']).length, 3);
});

test('decision value uses the PLAN §3.6 weights', () => {
  assert.equal(decisionValue({ usable: 1, transferable: 1, evidence: 1, novelty: 1, reach: 1 }), 1);
  assert.equal(decisionValue({ usable: 0, transferable: 1, evidence: 0, novelty: 0, reach: 0 }), 0.25);
});

test('quotes must really be in the text', () => {
  const text = 'It’s built on three.js (WebGL2).\nAll   code is public.';
  assert.ok(quoteIn("It's built on three.js (WebGL2).", text));
  assert.ok(quoteIn('all code is public', text));
  assert.ok(!quoteIn('It is built on WebGPU', text));
  assert.ok(!quoteIn('WebGL2', text), 'too short to be evidence');
});

test('slugify', () => {
  assert.equal(slugify("RIRRI'S"), 'rirris');
  assert.equal(slugify('NINE LOOPS: SUBWAY'), 'nine-loops-subway');
  assert.equal(slugify('故宫'), '');
});
