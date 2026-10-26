import { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createChatsycsMcpServer } from '../mcp/server.js';

/**
 * Servidor MCP por HTTP (modo sin estado: una instancia por petición, apto para serverless).
 * Se autentica como el resto de /api/* (Bearer ADMIN_API_KEY o una API key con permisos).
 *
 *   claude mcp add --transport http chatsyncs https://<tu-dominio>/api/mcp --header "Authorization: Bearer <clave>"
 */
export async function mcpRoutes(app: FastifyInstance) {
  app.post('/api/mcp', async (request, reply) => {
    const server = createChatsycsMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // El modo sin estado no admite streams SSE ni sesiones
  const notAllowed = async (_request: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: usa POST' }, id: null });
  app.get('/api/mcp', notAllowed);
  app.delete('/api/mcp', notAllowed);
}
