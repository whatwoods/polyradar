// API extraction needs a few hundred MB for the TypeScript checker, more than a
// Worker has, so it runs in a container (packages/apidiff/Dockerfile).
import { Container, getContainer } from '@cloudflare/containers';
import type { Extractor } from '@polyradar/apidiff';
import type { Env } from './env.ts';

export class ApiDiffContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
}

export function containerExtractor(env: Env): Extractor {
  return async (req) => {
    const init = { method: 'POST', body: JSON.stringify(req), headers: { 'content-type': 'application/json' } };
    const res = env.APIDIFF_URL
      ? await fetch(`${env.APIDIFF_URL}/extract`, init)
      : await getContainer(env.APIDIFF).fetch(new Request('http://container/extract', init));
    if (!res.ok) throw new Error(`extract ${req.typesPackage}@${req.version}: ${res.status} ${await res.text()}`);
    return res.json();
  };
}
