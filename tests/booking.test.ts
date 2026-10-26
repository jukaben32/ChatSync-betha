import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/prisma.js', () => ({ prisma: {} }));

import { computeSlots, describeSlot, formatSlot, zonedToUtc } from '../src/domain/booking.js';
import { DEFAULTS } from '../src/domain/settings.js';

const day = (enabled: boolean, start = '09:00', end = '11:00') => ({ enabled, start, end });
const settings = (over: Record<string, unknown> = {}) => ({
  ...DEFAULTS.booking,
  enabled: true,
  timezone: 'UTC',
  slotMinutes: 30,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  days: { mon: day(true), tue: day(true), wed: day(true), thu: day(true), fri: day(true), sat: day(false), sun: day(false) },
  ...over,
});

describe('zona horaria', () => {
  it('convierte hora local a UTC', () => {
    expect(zonedToUtc(2026, 10, 26, 9, 0, 'UTC').toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(zonedToUtc(2026, 10, 26, 9, 0, 'America/Santo_Domingo').toISOString()).toBe('2026-10-26T13:00:00.000Z'); // UTC-4 todo el año
  });
  it('respeta el cambio de hora de verano (EE. UU. termina el 1-nov-2026)', () => {
    expect(zonedToUtc(2026, 10, 30, 9, 0, 'America/New_York').toISOString()).toBe('2026-10-30T13:00:00.000Z'); // EDT, UTC-4
    expect(zonedToUtc(2026, 11, 2, 9, 0, 'America/New_York').toISOString()).toBe('2026-11-02T14:00:00.000Z'); // EST, UTC-5
  });
});

describe('huecos disponibles', () => {
  const monday = new Date('2026-10-26T06:00:00Z'); // lunes

  it('genera franjas dentro del horario, solo en días activos', () => {
    const slots = computeSlots(settings(), [], monday);
    expect(slots.slice(0, 4).map((s) => s.toISOString())).toEqual(['2026-10-26T09:00:00.000Z', '2026-10-26T09:30:00.000Z', '2026-10-26T10:00:00.000Z', '2026-10-26T10:30:00.000Z']);
    // sábado 31 y domingo 1 desactivados: tras el viernes 30 salta al lunes 2
    const days = new Set(slots.map((s) => s.toISOString().slice(0, 10)));
    expect(days.has('2026-10-31')).toBe(false);
    expect(days.has('2026-11-01')).toBe(false);
    expect(days.has('2026-11-02')).toBe(true);
  });

  it('respeta el aviso mínimo', () => {
    const now = new Date('2026-10-26T08:00:00Z');
    const slots = computeSlots(settings({ minNoticeHours: 2 }), [], now);
    expect(slots[0].toISOString()).toBe('2026-10-26T10:00:00.000Z'); // 08:00 + 2 h
  });

  it('no ofrece huecos ocupados ni solapados', () => {
    const booked = [new Date('2026-10-26T09:30:00Z')];
    const slots = computeSlots(settings(), booked, monday).map((s) => s.toISOString());
    expect(slots).not.toContain('2026-10-26T09:30:00.000Z');
    expect(slots).toContain('2026-10-26T09:00:00.000Z');
    expect(slots).toContain('2026-10-26T10:00:00.000Z');
  });

  it('respeta el límite y el horizonte', () => {
    expect(computeSlots(settings(), [], monday, 3)).toHaveLength(3);
    expect(computeSlots(settings({ maxDaysAhead: 0 }), [], monday)).toHaveLength(4);
    expect(computeSlots(settings({ enabled: true, days: { ...settings().days, mon: day(false), tue: day(false), wed: day(false), thu: day(false), fri: day(false) } }), [], monday)).toHaveLength(0);
  });

  it('usa el día local de la zona, no el UTC', () => {
    // 02:00Z del martes = lunes 22:00 en Santo Domingo → «hoy» es lunes y 09:00 local del lunes ya pasó
    const now = new Date('2026-10-27T02:00:00Z');
    const slots = computeSlots(settings({ timezone: 'America/Santo_Domingo' }), [], now);
    expect(slots[0].toISOString()).toBe('2026-10-27T13:00:00.000Z'); // martes 09:00 local
  });
});

describe('texto de los huecos', () => {
  it('formatea para el título de una fila (≤ 24 caracteres)', () => {
    const label = formatSlot(new Date('2026-10-26T13:00:00Z'), 'America/Santo_Domingo');
    expect(label).toMatch(/lun/);
    expect(label).toContain('09:00');
    expect(label.length).toBeLessThanOrEqual(24);
  });
  it('describe fecha y hora locales', () => {
    const d = describeSlot(new Date('2026-10-26T13:00:00Z'), 'America/Santo_Domingo');
    expect(d.date).toContain('lunes');
    expect(d.time).toBe('09:00');
  });
});
