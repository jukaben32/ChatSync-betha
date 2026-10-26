import { createHash, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { clientIp, ipAllowed, ipRules } from '../auth.js';
import { createSession, SESSION_HOURS } from '../session.js';
import { hashPassword, verifyPassword } from '../util/password.js';

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

// Hash de relleno: si el email no existe se verifica igualmente, para que la respuesta tarde lo mismo
const DUMMY_HASH = hashPassword('contraseña-de-relleno');

const sameKey = (a: string, b: string) => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/** Acceso al panel: clave de administrador o email + contraseña de un miembro del equipo. */
export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { key?: string; email?: string; password?: string };
    const ip = clientIp(request);

    if (!config.adminApiKey) return reply.code(503).send({ error: 'auth_not_configured' });
    if (!ipAllowed(ip, await ipRules())) return reply.code(403).send({ error: 'ip_not_allowed' });

    const recentFailures = await prisma.loginLog.count({ where: { ip, ok: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } });
    if (recentFailures >= MAX_FAILURES) return reply.code(429).send({ error: 'too_many_attempts', message: 'Demasiados intentos fallidos. Espera unos minutos.' });

    const log = (actor: string, role: string, ok: boolean) => prisma.loginLog.create({ data: { actor: actor.slice(0, 255), role, ip: ip.slice(0, 64) || null, ok } }).catch(() => undefined);

    // 1) clave de administrador
    if (body.key !== undefined) {
      if (body.key && sameKey(body.key, config.adminApiKey)) {
        await log('Admin', 'admin', true);
        return { role: 'admin', name: 'Admin', token: config.adminApiKey };
      }
      await log('Admin (clave incorrecta)', 'admin', false);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    // 2) email y contraseña de una persona del equipo
    const email = String(body.email ?? '').trim().toLowerCase();
    const member = email ? await prisma.teamMember.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }) : null;
    const passwordOk = verifyPassword(String(body.password ?? ''), member?.passwordHash ?? DUMMY_HASH);
    if (!member || !member.active || !member.passwordHash || !passwordOk) {
      await log(email || '(sin email)', member?.role === 'admin' ? 'admin' : 'agent', false);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    await log(member.name, member.role === 'admin' ? 'admin' : 'agent', true);
    return { role: member.role === 'admin' ? 'admin' : 'agent', name: member.name, id: member.id, token: createSession(member), expiresInHours: SESSION_HOURS };
  });

  // Quién soy (el panel lo usa para mostrar u ocultar secciones según el rol)
  app.get('/api/auth/me', async (request) => ({ role: request.actor?.role ?? 'api', name: request.actor?.name ?? '', id: request.actor?.id ?? null, ip: clientIp(request) }));

  app.get('/api/login-log', async () => prisma.loginLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }));
}
