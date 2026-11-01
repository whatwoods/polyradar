import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keysFromUrl, normalizeUrl } from '@polyradar/db/keys';
import { parseFeed } from '../src/collectors/rss.ts';
import { releaseLabel } from '../src/normalize.ts';
import { hrefs, keywordRelevance, stripHtml } from '../src/text.ts';

test('normalizeUrl drops www, tracking params, hash and trailing slash', () => {
  assert.equal(normalizeUrl('http://www.Example.com/a/b/?utm_source=x&b=2&a=1#top'), 'https://example.com/a/b?a=1&b=2');
  assert.equal(normalizeUrl('https://lo-th.github.io/landscape/'), 'https://lo-th.github.io/landscape');
  assert.equal(normalizeUrl('https://meep.dev/'), 'https://meep.dev');
  assert.equal(normalizeUrl('mailto:x@y.z'), null);
});

test('keysFromUrl finds repos, packages, papers and Pages sites', () => {
  const k = (u: string) => keysFromUrl(u).filter((x) => x.type !== 'url');
  assert.deepEqual(k('https://github.com/MrDoob/three.js/releases/tag/r187'), [{ type: 'github', key: 'mrdoob/three.js' }]);
  assert.deepEqual(k('https://lo-th.github.io/landscape/'), [{ type: 'github', key: 'lo-th/landscape' }]);
  assert.deepEqual(k('https://www.npmjs.com/package/@react-three/fiber/v/9.0.0'), [{ type: 'npm', key: '@react-three/fiber' }]);
  assert.deepEqual(k('https://arxiv.org/pdf/2510.01234v2.pdf'), [{ type: 'arxiv', key: '2510.01234' }]);
  assert.deepEqual(k('https://huggingface.co/papers/2510.01234'), [{ type: 'arxiv', key: '2510.01234' }]);
  assert.deepEqual(k('https://huggingface.co/tencent/Hunyuan3D-2'), [{ type: 'hf', key: 'tencent/hunyuan3d-2' }]);
  assert.deepEqual(k('https://github.com/sponsors/mrdoob'), []);
});

test('releaseLabel uses the project label for three and strips tag prefixes', () => {
  assert.equal(releaseLabel('0.187.0', 'three'), 'r187');
  assert.equal(releaseLabel('0.187.1', 'three'), 'r187.1');
  assert.equal(releaseLabel('r187', 'three'), 'r187');
  assert.equal(releaseLabel('0.187.0', '@types/three'), '0.187.0');
  assert.equal(releaseLabel('v10.7.6', '@react-three/drei'), '10.7.6');
  assert.equal(releaseLabel('@react-three/fiber@9.4.0', '@react-three/fiber'), '9.4.0');
});

test('html helpers', () => {
  const html = '<p>New <b>WebGPU</b> demo &amp; source: <a href="https://lo-th.github.io/landscape/">here</a></p><aside class="onebox">preview</aside><a href="/u/bob">@bob</a>';
  assert.equal(stripHtml(html), 'New WebGPU demo & source: here\n@bob');
  assert.deepEqual(hrefs(html), ['https://lo-th.github.io/landscape/']);
  assert.ok(keywordRelevance('Three.js WebGPU particles') >= 0.7);
  assert.equal(keywordRelevance('Quarterly earnings call'), 0);
});

test('parseFeed reads RSS and Atom', () => {
  const rss = parseFeed('<rss><channel><item><title>A &amp; B</title><link>https://x.dev/a</link><guid>g1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;hi&lt;/p&gt;</description></item></channel></rss>');
  assert.deepEqual(rss[0], { id: 'g1', title: 'A & B', link: 'https://x.dev/a', published: 'Mon, 26 Oct 2026 10:00:00 GMT', html: '<p>hi</p>', author: null });
  const atom = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>t3_1</id><title>Post</title><link href="https://reddit.com/r/threejs/1"/><updated>2026-10-26T10:00:00Z</updated><content type="html">body</content><author><name>/u/a</name></author></entry></feed>');
  assert.equal(atom[0]!.link, 'https://reddit.com/r/threejs/1');
  assert.equal(atom[0]!.author, '/u/a');
});
