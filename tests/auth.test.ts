import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_API_KEY = 'test-admin-key-0123456789';
});
vi.mock('../src/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/domain/settings.js', () => ({ getSetting: async () => ({ ipAllowlist: [] }) }));

import { agentAllowed, ipAllowed, maskPhone, maskPhonesInJson, normalizeIp, validIpRule } from '../src/auth.js';
import { createSession, readSession } from '../src/session.js';
import { hashPassword, verifyPassword } from '../src/util/password.js';

describe('contraseñas', () => {
  it('verifica la correcta y rechaza la incorrecta', () => {
    const hash = hashPassword('Mi-contraseña-segura');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('Mi-contraseña-segura');
    expect(verifyPassword('Mi-contraseña-segura', hash)).toBe(true);
    expect(verifyPassword('otra', hash)).toBe(false);
  });
  it('cada hash lleva sal distinta', () => {
    expect(hashPassword('igual')).not.toBe(hashPassword('igual'));
  });
  it('no acepta hashes ausentes o mal formados', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', 'texto-plano')).toBe(false);
  });
});

describe('sesiones', () => {
  const member = { id: 'm1', name: 'Ana', role: 'agent' };
  it('se firman y se leen', () => {
    const token = createSession(member);
    expect(token.startsWith('st.')).toBe(true);
    expect(readSession(token)).toMatchObject({ sub: 'm1', name: 'Ana', role: 'agent' });
  });
  it('caducan', () => {
    const token = createSession(member, Date.now() - 13 * 3600_000);
    expect(readSession(token)).toBeNull();
  });
  it('detectan manipulación del contenido o de la firma', () => {
    const token = createSession(member);
    const [body, sig] = token.slice(3).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'm1', name: 'Ana', role: 'admin', exp: 9999999999 })).toString('base64url');
    expect(readSession(`st.${forged}.${sig}`)).toBeNull();
    expect(readSession(`st.${body}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(readSession('st.basura')).toBeNull();
    expect(readSession('no-es-sesion')).toBeNull();
  });
  it('un administrador queda como admin', () => {
    expect(readSession(createSession({ id: 'a', name: 'Jefe', role: 'admin' }))?.role).toBe('admin');
  });
});

describe('IPs permitidas', () => {
  it('sin reglas se permite todo', () => {
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
  });
  it('IP exacta, rango CIDR e IPv6 mapeada', () => {
    expect(ipAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(ipAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
    expect(ipAllowed('10.1.2.3', ['10.1.0.0/16'])).toBe(true);
    expect(ipAllowed('10.2.2.3', ['10.1.0.0/16'])).toBe(false);
    expect(ipAllowed('::ffff:203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(ipAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(ipAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });
  it('valida las reglas', () => {
    for (const ok of ['1.2.3.4', '10.0.0.0/8', '::1', '2001:db8::1']) expect(validIpRule(ok)).toBe(true);
    for (const bad of ['999.1.1.1', '1.2.3.4/33', 'hola', '1.2.3', '1.2.3.4/']) expect(validIpRule(bad)).toBe(false);
    expect(normalizeIp(' ::ffff:1.2.3.4 ')).toBe('1.2.3.4');
  });
});

describe('permisos de un agente', () => {
  it('puede atender conversaciones y contactos', () => {
    expect(agentAllowed('GET', '/api/conversations')).toBe(true);
    expect(agentAllowed('POST', '/api/conversations/abc/messages')).toBe(true);
    expect(agentAllowed('PATCH', '/api/conversations/abc')).toBe(true);
    expect(agentAllowed('GET', '/api/subscribers')).toBe(true);
    expect(agentAllowed('PATCH', '/api/subscribers/abc')).toBe(true);
    expect(agentAllowed('POST', '/api/subscribers/abc/labels')).toBe(true);
    expect(agentAllowed('GET', '/api/team')).toBe(true);
    expect(agentAllowed('GET', '/api/auth/me')).toBe(true);
  });
  it('no puede configurar, exportar, borrar contactos ni usar claves', () => {
    for (const [m, p] of [
      ['GET', '/api/settings'],
      ['PUT', '/api/settings/security'],
      ['GET', '/api/api-keys'],
      ['POST', '/api/api-keys'],
      ['DELETE', '/api/subscribers/abc'],
      ['GET', '/api/subscribers/export'],
      ['POST', '/api/subscribers/bulk'],
      ['POST', '/api/subscribers/import'],
      ['GET', '/api/subscribers/stats'],
      ['POST', '/api/team'],
      ['DELETE', '/api/team/abc'],
      ['POST', '/api/broadcasts/abc/send'],
      ['POST', '/api/knowledge'],
      ['GET', '/api/webhooks'],
      ['POST', '/api/mcp'],
      ['POST', '/api/simulate/inbound'],
      ['GET', '/api/login-log'],
      ['POST', '/api/v1/whatsapp/send'],
    ] as const) {
      expect(agentAllowed(m, p), `${m} ${p}`).toBe(false);
    }
  });
});

describe('enmascarado de teléfonos', () => {
  it('oculta el centro del número', () => {
    expect(maskPhone('18095551234')).toBe('1809•••••34');
    expect(maskPhone('123')).toBe('123');
  });
  it('enmascara los campos de teléfono de una respuesta JSON y respeta el resto', () => {
    const json = JSON.stringify({ id: 'uuid-1', phone: '18095551234', name: 'Ana', subscriber: { phone: '5491155556666', chat_id: '5491155556666' }, body: 'llámame al 18095551234' });
    const masked = maskPhonesInJson(json);
    expect(masked).not.toContain('"phone":"18095551234"');
    expect(masked).not.toContain('"phone":"5491155556666"');
    expect(masked).not.toContain('"chat_id":"5491155556666"');
    expect(masked).toContain('"phone":"1809•••••34"');
    expect(masked).toContain('"name":"Ana"');
    expect(JSON.parse(masked).id).toBe('uuid-1');
  });
});
