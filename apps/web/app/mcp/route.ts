import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer(new URL(req.url).origin, req.headers.get('user-agent'));
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless mode: nothing outlives the request.
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
