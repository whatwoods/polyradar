import { discourse } from './discourse.ts';
import { github } from './github.ts';
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
};
