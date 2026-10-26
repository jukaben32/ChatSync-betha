import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { whatsappRoutes } from './whatsapp/webhook.js';
import { apiRoutes } from './api/routes.js';
import { authHook, usageLogHook } from './auth.js';

export const prisma = new PrismaClient();

export const app = Fastify({
  logger: true,
});

// Conserva el cuerpo crudo: Meta firma el payload (X-Hub-Signature-256) y hay que validarlo byte a byte.
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body: Buffer, done) => {
  (request as any).rawBody = body;
  if (!body.length) return done(null, {});
  try {
    done(null, JSON.parse(body.toString('utf8')));
  } catch (error) {
    (error as any).statusCode = 400;
    done(error as Error, undefined);
  }
});

// Formularios (application/x-www-form-urlencoded): lo usa la API v1 compatible con ChatSyncs
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body: string, done) => {
  done(null, Object.fromEntries(new URLSearchParams(body)));
});

app.register(cors, { origin: true });
app.addHook('onRequest', authHook);
app.addHook('onResponse', usageLogHook);
app.register(whatsappRoutes, { prefix: '/api/whatsapp' });
app.register(apiRoutes);

export async function buildApp() {
  return app;
}

export async function start() {
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
}
