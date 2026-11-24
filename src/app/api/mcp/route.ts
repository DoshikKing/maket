import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateMcp } from '@/lib/mcp-keys';
import { createMcpServer } from '@/lib/mcp-server';
import { readJsonBody } from '@/lib/http-body';
import { requestOrigin } from '@/lib/request-origin';
import { ModelError, reject } from '@/lib/model-errors';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    if (
      (request.headers.get('origin') && request.headers.get('origin') !== requestOrigin(request)) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return Response.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({ error: 'Требуется application/json' }, { status: 415 });
    const identity = await authenticateMcp(request);
    const body = await readJsonBody(request);
    if (Array.isArray(body)) reject(400, 'Пакетные MCP-запросы не поддерживаются');
    const server = await createMcpServer(identity);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const status =
      error instanceof ModelError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return Response.json(
      {
        error:
          status === 500
            ? 'Не удалось выполнить MCP-запрос'
            : error instanceof Error
              ? error.message
              : 'Ошибка запроса',
      },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="maket-mcp"' } : {}),
        },
      },
    );
  }
}
function unsupported() {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}
export { unsupported as GET, unsupported as DELETE };
