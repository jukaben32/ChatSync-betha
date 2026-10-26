import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { prisma } from './prisma.js';

// Rutas públicas: health, webhook de Meta (se valida con verify token / firma) y cron (CRON_SECRET).
const PUBLIC_PREFIXES = ['/api/health', '/api/whatsapp/webhook', '/api/cron/'];

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function extractKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

/** Hook onRequest: exige ADMIN_API_KEY o una API key creada desde el panel en todo /api/*. */
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?')[0];
  if (request.method === 'OPTIONS') return;
  if (!path.startsWith('/api')) return;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return;

  if (!config.adminApiKey) {
    return reply.code(503).send({ error: 'auth_not_configured', message: 'Define ADMIN_API_KEY en el entorno.' });
  }
  const key = extractKey(request);
  if (!key) return reply.code(401).send({ error: 'unauthorized' });
  if (safeEqual(key, config.adminApiKey)) return;

  const record = await prisma.apiKey.findUnique({ where: { hash: sha256(key) } });
  if (record) {
    await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    return;
  }
  return reply.code(401).send({ error: 'unauthorized' });
}
