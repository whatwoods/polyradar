import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arxivQuery } from '../src/collectors/arxiv.ts';
import { keywordMatcher, postLinks } from '../src/streams/jetstream.ts';
import { paperRelevance } from '../src/text.ts';

test('keyword matcher respects word boundaries and spacing variants', () => {
  const m = keywordMatcher(['three.js', 'webgpu', 'gaussian splatting', 'react three fiber']);
  assert.ok(m('New demo in Three.js!'));
  assert.ok(m('#WebGPU compute is here'));
  assert.ok(m('react-three-fiber tips'));
  assert.ok(m('Gaussian-splatting viewer'));
  assert.ok(!m('threejsfoo'));
  assert.ok(!m('one two three js'));
});

test('post links come from facets and external embeds', () => {
  assert.deepEqual(postLinks({
    facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.dev' }, { $type: 'app.bsky.richtext.facet#tag', tag: 'webgpu' }] }],
    embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://b.dev' } },
  }), ['https://a.dev', 'https://b.dev']);
});

test('arXiv query combines full categories with keyword-filtered ones', () => {
  const q = arxivQuery({ categories: ['cs.GR'], keyword_categories: ['cs.CV'], keywords: ['gaussian splatting'] }, new Date('2026-10-24T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  assert.equal(q, '((cat:cs.GR) OR ((cat:cs.CV) AND (abs:"gaussian splatting"))) AND submittedDate:[202610240000 TO 202611010000]');
});

test('paper gate keeps 3D/world/game papers and drops the rest', () => {
  assert.ok(paperRelevance('VibeGame: Prompt-to-Game Development with AI-Native Engine') >= 0.25);
  assert.ok(paperRelevance('L3G-World: Real-Time Infinite World Generation with Latent 3D Gaussian Memory') >= 0.25);
  assert.ok(paperRelevance('EPSBench: Benchmarking LLM Agents for Earnings Forecasting') < 0.25);
});
