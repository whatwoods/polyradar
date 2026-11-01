import { arxiv } from './arxiv.ts';
import { discourse } from './discourse.ts';
import { github } from './github.ts';
import { hfModels, hfPapers } from './hf.ts';
import { hn } from './hn.ts';
import { npm } from './npm.ts';
import { rss } from './rss.ts';
import type { Collector } from './types.ts';

export const COLLECTORS: Record<string, Collector> = {
  discourse,
  github_repo: github,
  npm,
  hn,
  rss,
  reddit: rss,
  arxiv,
  hf_papers: hfPapers,
  hf_models: hfModels,
};
