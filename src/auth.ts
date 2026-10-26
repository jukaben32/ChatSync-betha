import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { prisma } from './prisma.js';
import { readSession, SESSION_PREFIX } from './session.js';
import { getSetting } from './domain/settings.js';

// Rutas públicas: health, login, webhook de Meta (verify token + firma), cron (CRON_SECRET) y receptores de Webhook Workflow (token en la URL).
// /api/v1/ se autentica en su propio plugin (el `apiToken` puede ir en el cuerpo, que aún no está leído en onRequest).
const PUBLIC_PREFIXES = ['/api/health', '/api/auth/login', '/api/whatsapp/webhook', '/api/cron/', '/api/hooks/', '/api/v1/'];

// Solo la clave de administrador (o un miembro con rol admin) puede tocar estas rutas; las API keys no.
const ADMIN_ONLY_PREFIXES = ['/api/api-keys', '/api/settings', '/api/api-logs', '/api/simulate', '/api/login-log'];

export type Scope = 'read' | 'write' | 'send';
export const SCOPES: Scope[] = ['read', 'write', 'send'];

export interface Actor {
  /** id del miembro del equipo (solo en sesiones de persona) */
  id?: string;
  name: string;
  role: 'admin' | 'agent' | 'api';
}

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

// ---------- IP permitidas ----------

/** Quita el prefijo IPv4-mapeado de IPv6 (::ffff:1.2.3.4). */
export function normalizeIp(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

const ipv4ToInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const isIpv4 = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((p) => Number(p) <= 255);

/** ¿La IP encaja con alguna regla? Reglas: IP exacta (IPv4/IPv6) o rango IPv4 en notación CIDR (10.0.0.0/24). */
export function ipAllowed(ip: string, rules: string[]): boolean {
  if (!rules.length) return true;
  const addr = normalizeIp(ip);
  return rules.some((raw) => {
    const rule = normalizeIp(raw);
    if (!rule.includes('/')) return rule === addr;
    const [base, bits] = rule.split('/');
    // la máscara debe ser un número explícito: «1.2.3.4/» no puede leerse como /0 (= todas las IPs)
    if (!/^[0-9]{1,2}$/.test(bits ?? '')) return false;
    const n = Number(bits);
    if (!isIpv4(base) || !isIpv4(addr) || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (ipv4ToInt(addr) & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Valida una regla antes de guardarla (IP exacta o CIDR IPv4). */
export function validIpRule(raw: string): boolean {
  const rule = normalizeIp(raw);
  if (rule.includes('/')) {
    const [base, bits] = rule.split('/');
    return isIpv4(base) && /^[0-9]{1,2}$/.test(bits ?? '') && Number(bits) <= 32;
  }
  return isIpv4(rule) || (rule.includes(':') && /^[0-9a-f:]+$/i.test(rule));
}

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return normalizeIp(first || request.ip || '');
}

// La lista de IPs se consulta en cada petición: se cachea unos segundos para no cargar la BD.
let ipCache: { rules: string[]; at: number } | null = null;
export function invalidateIpCache() {
  ipCache = null;
}
export async function ipRules(): Promise<string[]> {
  if (ipCache && Date.now() - ipCache.at < 15_000) return ipCache.rules;
  const rules = (await getSetting('security')).ipAllowlist;
  ipCache = { rules, at: Date.now() };
  return rules;
}

// ---------- Permisos de las personas del equipo con rol «agent» ----------

type Rule = { methods: string[]; pattern: RegExp };
const GET_ONLY = ['GET'];
const ANY = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

const AGENT_RULES: Rule[] = [
  { methods: ANY, pattern: /^\/api\/conversations(\/|$)/ },
  { methods: ANY, pattern: /^\/api\/ai\// },
  { methods: ANY, pattern: /^\/api\/(crm|appointments|booking)(\/|$)/ },
  { methods: ANY, pattern: /^\/api\/subscribers\/[^/]+\/(labels|lists|notes|crm)(\/|$)/ },
  { methods: GET_ONLY, pattern: /^\/api\/subscribers(\/[^/]+)?$/ },
  { methods: ['PATCH'], pattern: /^\/api\/subscribers\/[^/]+$/ },
  { methods: ['POST'], pattern: /^\/api\/subscribers$/ },
  { methods: GET_ONLY, pattern: /^\/api\/subscribers\/[^/]+\/insights$/ },
  { methods: GET_ONLY, pattern: /^\/api\/(account|labels|lists|team|canned-responses|custom-fields|templates|sequences|forms|auth\/me)(\/|$)/ },
];

// /api/subscribers/{stats,export,bulk,import} no son fichas de contacto: el patrón de arriba no debe darles paso
const AGENT_DENIED = /^\/api\/subscribers\/(stats|export|bulk|import)$/;

/** Un agente puede atender conversaciones y contactos, pero no configurar, exportar, borrar contactos ni tocar claves. */
export function agentAllowed(method: string, path: string): boolean {
  if (AGENT_DENIED.test(path)) return false;
  return AGENT_RULES.some((r) => r.methods.includes(method) && r.pattern.test(path));
}

export type AuthResult = { ok: true; actor: Actor } | { ok: false; status: number; error: string; required?: Scope };

/** Valida una credencial: clave de administrador, sesión de persona del equipo o API key activa con alcance. */
export async function authenticate(key: string, method: string, path: string, ip = ''): Promise<AuthResult> {
  if (!config.adminApiKey) return { ok: false, status: 503, error: 'auth_not_configured' };
  if (!key) return { ok: false, status: 401, error: 'unauthorized' };

  const isAdminKey = safeEqual(key, config.adminApiKey);
  const session = !isAdminKey && key.startsWith(SESSION_PREFIX) ? readSession(key) : null;
  const apiKey = !isAdminKey && !session && !key.startsWith(SESSION_PREFIX) ? await prisma.apiKey.findUnique({ where: { hash: sha256(key) } }) : null;
  if (!isAdminKey && !session && (!apiKey || !apiKey.active)) return { ok: false, status: 401, error: 'unauthorized' };

  // Lista de IPs permitidas: se comprueba tras validar la credencial para no revelar nada a quien no la tiene
  if (ip && !ipAllowed(ip, await ipRules())) return { ok: false, status: 403, error: 'ip_not_allowed' };

  if (isAdminKey) return { ok: true, actor: { name: 'Admin', role: 'admin' } };

  if (session) {
    // La sesión sigue siendo válida solo mientras el miembro exista y esté activo; el rol se lee de la BD, no del token
    const member = await prisma.teamMember.findUnique({ where: { id: session.sub } });
    if (!member || !member.active) return { ok: false, status: 401, error: 'unauthorized' };
    const role = member.role === 'admin' ? 'admin' : 'agent';
    if (role === 'agent' && !agentAllowed(method, path)) return { ok: false, status: 403, error: 'forbidden_for_role' };
    return { ok: true, actor: { id: member.id, name: member.name, role } };
  }

  if (ADMIN_ONLY_PREFIXES.some((p) => path.startsWith(p))) return { ok: false, status: 403, error: 'admin_key_required' };
  const required = requiredScope(method, path);
  if (apiKey!.scopes.length && !apiKey!.scopes.includes(required)) return { ok: false, status: 403, error: 'insufficient_scope', required };
  await prisma.apiKey.update({ where: { id: apiKey!.id }, data: { lastUsedAt: new Date() } });
  return { ok: true, actor: { name: apiKey!.name, role: 'api' } };
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyName?: string;
    actor?: Actor;
  }
}

/** Hook onRequest: exige credencial válida en todo /api/* (salvo las rutas públicas). */
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?')[0];
  if (request.method === 'OPTIONS') return;
  if (!path.startsWith('/api')) return;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return;

  const result = await authenticate(extractKey(request), request.method, path, clientIp(request));
  if (result.ok) {
    request.actor = result.actor;
    if (result.actor.role === 'api') request.apiKeyName = result.actor.name;
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

// ---------- Enmascarado de teléfonos para agentes ----------

/** 18095551234 → 1809•••••34 */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, 4) + '•'.repeat(phone.length - 6) + phone.slice(-2);
}

/** Enmascara los campos de teléfono de un JSON (las personas del equipo con rol agente no ven números completos). */
export function maskPhonesInJson(json: string): string {
  return json.replace(/"(phone|chat_id|phone_number)":"(\d{7,15})"/g, (_m, key: string, num: string) => `"${key}":"${maskPhone(num)}"`);
}

/** Hook onSend: aplica el enmascarado a las respuestas JSON de agentes. */
export async function maskHook(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
  if (request.actor?.role !== 'agent' || typeof payload !== 'string') return payload;
  if (!String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload;
  return maskPhonesInJson(payload);
}
