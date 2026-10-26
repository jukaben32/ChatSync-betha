import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export interface SessionPayload {
  sub: string; // id del miembro del equipo
  name: string;
  role: 'admin' | 'agent';
  exp: number; // epoch en segundos
}

export const SESSION_PREFIX = 'st.';
export const SESSION_HOURS = 12;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
// La clave de firma deriva de ADMIN_API_KEY: rotarla cierra todas las sesiones.
const sign = (data: string) => createHmac('sha256', `session:${config.adminApiKey}`).update(data).digest('base64url');

export function createSession(member: { id: string; name: string; role: string }, now = Date.now()): string {
  const payload: SessionPayload = { sub: member.id, name: member.name, role: member.role === 'admin' ? 'admin' : 'agent', exp: Math.floor(now / 1000) + SESSION_HOURS * 3600 };
  const body = b64(JSON.stringify(payload));
  return `${SESSION_PREFIX}${body}.${sign(body)}`;
}

export function readSession(token: string, now = Date.now()): SessionPayload | null {
  if (!config.adminApiKey || !token.startsWith(SESSION_PREFIX)) return null;
  const [body, sig] = token.slice(SESSION_PREFIX.length).split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}
