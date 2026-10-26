import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { whatsappRoutes } from './whatsapp/webhook.js';
import { apiRoutes } from './api/routes.js';
import { startMcpServer } from './mcp/server.js';

export const prisma = new PrismaClient();

export const app = Fastify({
  logger: true,
});

app.register(cors, { origin: true });
app.register(whatsappRoutes, { prefix: '/api/whatsapp' });
app.register(apiRoutes);

export async function buildApp() {
  return app;
}

export async function start() {
  const mcp = await startMcpServer(app);
  if (mcp) {
    app.log.info({ server: 'chatsyncs-mcp' }, 'mcp_server_started');
  }
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
}
