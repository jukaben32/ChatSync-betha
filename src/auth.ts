import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { prisma } from './prisma.js';

// Rutas públicas: health, webhook de Meta (verify token + firma), cron (CRON_SECRET) y receptores de Webhook Workflow (token en la URL).
// /api/v1/ se autentica en su propio plugin (el `apiToken` puede ir en el cuerpo, que aún no está leído en onRequest).
const PUBLIC_PREFIXES = ['/api/health', '/api/whatsapp/webhook', '/api/cron/', '/api/hooks/', '/api/v1/'];

// Solo la clave de administrador (no las API keys) puede tocar estas rutas.
const ADMIN_ONLY_PREFIXES = ['/api/api-keys', '/api/settings', '/api/api-logs', '/api/simulate'];

export type Scope = 'read' | 'write' | 'send';
export const SCOPES: Scope[] = ['read', 'write', 'send'];

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

/** Qué permiso exige una petición: leer, escribir o enviar mensajes. */
export function requiredScope(method: string, path: string): Scope {
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (/\/messages$|\/broadcasts\/[^/]+\/send$|\/trigger$|\/enroll$/.test(path)) return 'send';
  return 'write';
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyName?: string;
  }
}

export type AuthResult = { ok: true; keyName?: string } | { ok: false; status: number; error: string; required?: Scope };

/** Valida una clave: ADMIN_API_KEY (acceso total) o una API key activa con el alcance necesario. */
export async function authenticate(key: string, method: string, path: string): Promise<AuthResult> {
  if (!config.adminApiKey) return { ok: false, status: 503, error: 'auth_not_configured' };
  if (!key) return { ok: false, status: 401, error: 'unauthorized' };
  if (safeEqual(key, config.adminApiKey)) return { ok: true };
  if (ADMIN_ONLY_PREFIXES.some((p) => path.startsWith(p))) return { ok: false, status: 403, error: 'admin_key_required' };
  const record = await prisma.apiKey.findUnique({ where: { hash: sha256(key) } });
  if (!record || !record.active) return { ok: false, status: 401, error: 'unauthorized' };
  const required = requiredScope(method, path);
  if (record.scopes.length && !record.scopes.includes(required)) return { ok: false, status: 403, error: 'insufficient_scope', required };
  await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return { ok: true, keyName: record.name };
}

/** Hook onRequest: exige ADMIN_API_KEY o una API key activa (con alcance) en todo /api/*. */
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?')[0];
  if (request.method === 'OPTIONS') return;
  if (!path.startsWith('/api')) return;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return;

  const result = await authenticate(extractKey(request), request.method, path);
  if (result.ok) {
    request.apiKeyName = result.keyName;
    return;
  }
  if (result.error === 'auth_not_configured') return reply.code(503).send({ error: result.error, message: 'Define ADMIN_API_KEY en el entorno.' });
  return reply.code(result.status).send({ error: result.error, ...(result.required ? { required: result.required } : {}) });
}

/** Hook onResponse: registro de uso de las API keys (no de la clave de administrador, para no inundar el log con el panel). */
export async function usageLogHook(request: FastifyRequest, reply: FastifyReply) {
  if (!request.apiKeyName) return;
  try {
    await prisma.apiLog.create({
      data: { keyName: request.apiKeyName.slice(0, 64), method: request.method, path: request.url.split('?')[0].slice(0, 255), status: reply.statusCode },
    });
  } catch {
    /* el log nunca debe romper la petición */
  }
}
