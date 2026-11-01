// The container's only job: POST /extract {typesPackage, version, tarball, entries}
// returns that version's API symbols. Stateless; the Worker does diffing and writes.
import { createServer } from 'node:http';
import { localExtractor } from './local.ts';

const port = Number(process.env.PORT ?? 8080);

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return void res.end('ok');
  if (req.method !== 'POST' || req.url !== '/extract') return void res.writeHead(404).end();
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const t0 = Date.now();
    const api = await localExtractor(JSON.parse(body));
    console.log(`extracted ${api.length} symbols in ${Date.now() - t0}ms`);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(api));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end(err instanceof Error ? err.message : String(err));
  }
}).listen(port, () => console.log(`apidiff extractor on :${port}`));
