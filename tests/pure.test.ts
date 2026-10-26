import { describe, expect, it, vi } from 'vitest';

// Los módulos importan el cliente de Prisma; en estos tests solo se usa lógica pura.
vi.mock('../src/prisma.js', () => ({ prisma: {} }));

import { isOpenNow, DEFAULTS } from '../src/domain/settings.js';
import { renderVars } from '../src/domain/messaging.js';
import { requiredScope } from '../src/auth.js';
import { assertPublicUrl, getPath, isPrivateHost } from '../src/util/net.js';
import { env } from '../src/config.js';

const hours = (over: Partial<typeof DEFAULTS.businessHours> = {}) => ({ ...DEFAULTS.businessHours, enabled: true, timezone: 'UTC', ...over });

describe('horario comercial', () => {
  it('siempre abierto si está desactivado', () => {
    expect(isOpenNow({ ...hours(), enabled: false }, new Date('2026-10-25T03:00:00Z'))).toBe(true);
  });
  it('abierto en un día laborable dentro del horario', () => {
    // 2026-10-26 es lunes
    expect(isOpenNow(hours(), new Date('2026-10-26T10:30:00Z'))).toBe(true);
  });
  it('cerrado fuera de la franja y en días desactivados', () => {
    expect(isOpenNow(hours(), new Date('2026-10-26T20:00:00Z'))).toBe(false);
    expect(isOpenNow(hours(), new Date('2026-10-25T10:30:00Z'))).toBe(false); // domingo
  });
  it('respeta la zona horaria', () => {
    // 14:00 UTC = 10:00 en Santo Domingo (UTC-4)
    expect(isOpenNow(hours({ timezone: 'America/Santo_Domingo' }), new Date('2026-10-26T14:00:00Z'))).toBe(true);
    expect(isOpenNow(hours({ timezone: 'America/Santo_Domingo' }), new Date('2026-10-26T07:00:00Z'))).toBe(false);
  });
});

describe('variables de mensaje', () => {
  const sub = { name: 'Ana', phone: '1809', email: null, customFields: { ciudad: 'Santiago', edad: 30 } };
  it('sustituye nombre, teléfono y campos personalizados', () => {
    expect(renderVars('Hola {{name}} de {{ciudad}} ({{phone}})', sub)).toBe('Hola Ana de Santiago (1809)');
    expect(renderVars('{{field.edad}} años', sub)).toBe('30 años');
  });
  it('deja vacío lo que no existe', () => {
    expect(renderVars('[{{email}}] [{{nada}}]', sub)).toBe('[] []');
  });
});

describe('alcance de API keys', () => {
  it('lectura, escritura y envío', () => {
    expect(requiredScope('GET', '/api/subscribers')).toBe('read');
    expect(requiredScope('POST', '/api/subscribers')).toBe('write');
    expect(requiredScope('POST', '/api/conversations/abc/messages')).toBe('send');
    expect(requiredScope('POST', '/api/broadcasts/abc/send')).toBe('send');
    expect(requiredScope('POST', '/api/sequences/abc/trigger')).toBe('send');
    expect(requiredScope('DELETE', '/api/labels/abc')).toBe('write');
  });
});

describe('red y utilidades', () => {
  it('bloquea destinos internos', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.169.254', 'db.internal']) expect(isPrivateHost(h)).toBe(true);
    expect(isPrivateHost('example.com')).toBe(false);
    expect(() => assertPublicUrl('http://169.254.169.254/latest')).toThrow();
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow();
    expect(assertPublicUrl('https://example.com/x').hostname).toBe('example.com');
  });
  it('lee rutas anidadas', () => {
    expect(getPath({ customer: { name: 'Luis' }, items: [{ sku: 'A1' }] }, 'customer.name')).toBe('Luis');
    expect(getPath({ items: [{ sku: 'A1' }] }, 'items.0.sku')).toBe('A1');
    expect(getPath({}, 'a.b.c')).toBeUndefined();
  });
  it('los valores de relleno cuentan como no definidos', () => {
    process.env.TEST_X = 'pending';
    expect(env('TEST_X')).toBe('');
    process.env.TEST_X = 'real-value';
    expect(env('TEST_X')).toBe('real-value');
  });
});

import { matchesKeyword } from '../src/domain/inbound.js';
import { subscriberWhere } from '../src/domain/subscriber-filters.js';

describe('palabras clave de flujos', () => {
  it('contains, exact y starts', () => {
    expect(matchesKeyword('quiero el menu por favor', 'menu', 'contains')).toBe(true);
    expect(matchesKeyword('menu', 'menu', 'exact')).toBe(true);
    expect(matchesKeyword('el menu', 'menu', 'exact')).toBe(false);
    expect(matchesKeyword('menu del dia', 'menu', 'starts')).toBe(true);
    expect(matchesKeyword('ver menu', 'menu', 'starts')).toBe(false);
    expect(matchesKeyword('hola', null, 'contains')).toBe(false);
  });
});

describe('filtros de contactos', () => {
  it('traduce los filtros a condiciones de Prisma', () => {
    expect(subscriberWhere({})).toEqual({});
    expect(subscriberWhere({ status: 'subscribed' })).toMatchObject({ blocked: false, optedOut: false });
    expect(subscriberWhere({ status: 'unsubscribed' })).toMatchObject({ optedOut: true });
    expect(subscriberWhere({ status: 'blocked' })).toMatchObject({ blocked: true });
    expect(subscriberWhere({ list: 'VIP' }).lists.some.list.name).toBe('VIP');
    expect(subscriberWhere({ sequence: 'abc' }).sequences.some).toMatchObject({ sequenceId: 'abc', status: 'active' });
    expect(subscriberWhere({ q: 'ana' }).OR).toHaveLength(3);
  });
});

import { chunkText, rankChunks, tokenize } from '../src/ai/knowledge.js';

describe('base de conocimiento por fragmentos', () => {
  it('tokeniza sin tildes ni palabras vacías', () => {
    expect(tokenize('¿Cuál es el horario de atención?')).toEqual(['horar', 'atenc']);
  });

  it('un texto corto es un solo fragmento', () => {
    expect(chunkText('Hola mundo')).toEqual(['Hola mundo']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('un texto largo se parte en fragmentos acotados que cubren todo el contenido', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Esta es la frase número ${i} sobre un tema distinto cada vez.`).join(' ');
    const chunks = chunkText(text, 400, 60);
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(480);
    for (const n of [0, 30, 59]) expect(chunks.some((c) => c.includes(`número ${n} `))).toBe(true);
  });

  it('un párrafo gigante sin puntos también se corta', () => {
    const chunks = chunkText('palabra '.repeat(1000), 500, 50);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 560)).toBe(true);
  });

  it('recupera el fragmento relevante para la pregunta', () => {
    const chunks = [
      { id: '1', title: 'Horarios', text: 'Atendemos de lunes a viernes de 9 a 18 horas. Los sábados cerramos a las 13.' },
      { id: '2', title: 'Envíos', text: 'El envío a domicilio tarda 3 días hábiles y cuesta 5 dólares.' },
      { id: '3', title: 'Devoluciones', text: 'Aceptamos devoluciones durante 7 días con el empaque original.' },
    ];
    expect(rankChunks('¿A qué hora abren los sábados?', chunks, 1)[0].id).toBe('1');
    expect(rankChunks('cuánto tarda el envío', chunks, 1)[0].id).toBe('2');
    expect(rankChunks('puedo devolver mi compra', chunks, 1)[0].id).toBe('3');
    expect(rankChunks('xyz qwerty', chunks)).toEqual([]);
  });
});
