import { prisma } from '../prisma.js';
import { getSetting } from './settings.js';
import type { BookingSettings } from './settings.js';
import { emitEvent } from './events.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MIN = 60_000;

/** Diferencia (en minutos) entre la hora local de `tz` y UTC en el instante `date`. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / MIN;
}

/** Instante UTC que corresponde a una hora de pared (año, mes, día, hora, minuto) en la zona `tz`. Respeta cambios de hora. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off1 * MIN;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * MIN;
  return new Date(t);
}

/** Año/mes/día de «hoy» en la zona `tz`. */
function localToday(now: Date, tz: string): { y: number; m: number; d: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Huecos libres: por cada día con horario activo, franjas de `slotMinutes` desde la apertura hasta el cierre,
 * respetando el aviso mínimo y sin solaparse con citas ya reservadas. Función pura (recibe `now` y las citas).
 */
export function computeSlots(settings: BookingSettings, booked: Date[], now = new Date(), limit = Infinity): Date[] {
  const slots: Date[] = [];
  const earliest = now.getTime() + settings.minNoticeHours * 60 * MIN;
  const step = Math.max(5, settings.slotMinutes);
  const today = localToday(now, settings.timezone);

  for (let offset = 0; offset <= settings.maxDaysAhead && slots.length < limit; offset++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
    const cfg = settings.days[DAY_KEYS[day.getUTCDay()]];
    if (!cfg?.enabled) continue;
    for (let t = toMinutes(cfg.start); t + step <= toMinutes(cfg.end) && slots.length < limit; t += step) {
      const start = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(t / 60), t % 60, settings.timezone);
      if (start.getTime() < earliest) continue;
      if (booked.some((b) => Math.abs(b.getTime() - start.getTime()) < step * MIN)) continue;
      slots.push(start);
    }
  }
  return slots;
}

/** «lun 28 oct 10:00» (cabe en el título de 24 caracteres de una fila de lista de WhatsApp). */
export function formatSlot(date: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('es', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value.replace(/\.$/, '')]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/** Texto largo para confirmaciones y recordatorios: «lunes, 28 de octubre a las 10:00». */
export function describeSlot(date: Date, tz: string): { date: string; time: string } {
  return {
    date: new Intl.DateTimeFormat('es', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(date),
    time: new Intl.DateTimeFormat('es', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date),
  };
}

export async function availableSlots(limit = 10, now = new Date()): Promise<Date[]> {
  const settings = await getSetting('booking');
  if (!settings.enabled) return [];
  const booked = await prisma.appointment.findMany({ where: { status: 'booked', startsAt: { gte: now } }, select: { startsAt: true } });
  return computeSlots(settings, booked.map((b) => b.startsAt), now, limit);
}

export class BookingError extends Error {
  constructor(public code: 'booking_disabled' | 'slot_unavailable' | 'slot_taken' | 'subscriber_not_found') {
    super(code);
  }
}

/** Reservas internas de recordatorios: una secuencia interna de un paso por cada aviso, que se borra al ejecutarse. */
async function scheduleReminders(appointmentId: string, subscriberId: string, startsAt: Date, settings: BookingSettings) {
  const { date, time } = describeSlot(startsAt, settings.timezone);
  for (const hours of settings.reminderHours) {
    const runAt = new Date(startsAt.getTime() - hours * 60 * MIN);
    if (runAt.getTime() < Date.now() + MIN) continue;
    const step = settings.reminderTemplate.trim()
      ? { action: 'send_template', params: { templateName: settings.reminderTemplate.trim(), language: settings.reminderLanguage || 'es', variables: [date, time] } }
      : { action: 'send_text', params: { body: `Recordatorio: tienes una cita el ${date} a las ${time}.` } };
    const sequence = await prisma.sequence.create({
      data: { name: `__appt_${appointmentId}_${hours}`, kind: 'internal', steps: { create: [{ ...step, params: step.params as never, delayDays: 0, order: 0 }] } },
    });
    await prisma.scheduledJob.create({ data: { subscriberId, sequenceId: sequence.id, resumeOrder: 0, runAt } });
  }
}

export async function removeReminders(appointmentId: string) {
  await prisma.sequence.deleteMany({ where: { kind: 'internal', name: { startsWith: `__appt_${appointmentId}_` } } });
}

/**
 * Reserva un hueco. Comprueba que siga libre y confía en el índice único parcial de la BD para impedir dobles reservas
 * cuando dos clientes eligen el mismo hueco a la vez.
 */
export async function bookSlot(params: { subscriberId: string; startsAt: Date; title?: string; notes?: string; force?: boolean }) {
  const settings = await getSetting('booking');
  if (!settings.enabled && !params.force) throw new BookingError('booking_disabled');
  if (!params.force) {
    const free = await availableSlots(500);
    if (!free.some((s) => s.getTime() === params.startsAt.getTime())) throw new BookingError('slot_unavailable');
  }
  let appointment;
  try {
    appointment = await prisma.appointment.create({
      data: { subscriberId: params.subscriberId, startsAt: params.startsAt, endsAt: new Date(params.startsAt.getTime() + settings.slotMinutes * MIN), title: params.title || settings.title, notes: params.notes },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new BookingError('slot_taken');
    throw e;
  }
  await scheduleReminders(appointment.id, params.subscriberId, params.startsAt, settings);
  const subscriber = await prisma.subscriber.findUnique({ where: { id: params.subscriberId }, select: { phone: true, name: true } });
  await emitEvent('appointment.booked', { id: appointment.id, phone: subscriber?.phone, name: subscriber?.name, startsAt: appointment.startsAt, title: appointment.title });
  return appointment;
}

export async function cancelAppointment(id: string, status: 'cancelled' | 'completed' | 'no_show' = 'cancelled') {
  const appointment = await prisma.appointment.update({ where: { id }, data: { status } });
  await removeReminders(id);
  return appointment;
}
