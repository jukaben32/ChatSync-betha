import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { availableSlots, BookingError, bookSlot, cancelAppointment, describeSlot, formatSlot } from '../domain/booking.js';
import { getSetting } from '../domain/settings.js';
import { sendMessage } from '../domain/messaging.js';

const STATUSES = ['booked', 'cancelled', 'completed', 'no_show'];

const bookingErrors: Record<string, { status: number; message: string }> = {
  booking_disabled: { status: 409, message: 'Las citas están desactivadas en Ajustes → Citas.' },
  slot_unavailable: { status: 409, message: 'Ese horario no está disponible.' },
  slot_taken: { status: 409, message: 'Ese horario acaba de ocuparse.' },
};

/** Citas: huecos libres, reservas, estados y recordatorios. */
export async function bookingRoutes(app: FastifyInstance) {
  app.get('/api/booking/slots', async (request) => {
    const q = request.query as { limit?: string };
    const settings = await getSetting('booking');
    const slots = await availableSlots(Math.min(Number(q.limit ?? 30), 200));
    return { enabled: settings.enabled, timezone: settings.timezone, slots: slots.map((s) => ({ startsAt: s.toISOString(), label: formatSlot(s, settings.timezone) })) };
  });

  app.get('/api/appointments', async (request) => {
    const q = request.query as { from?: string; to?: string; status?: string; phone?: string };
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 86_400_000);
    const to = q.to ? new Date(q.to) : undefined;
    return prisma.appointment.findMany({
      where: {
        startsAt: { gte: from, ...(to ? { lte: to } : {}) },
        ...(q.status && STATUSES.includes(q.status) ? { status: q.status } : {}),
        ...(q.phone ? { subscriber: { phone: q.phone } } : {}),
      },
      include: { subscriber: { select: { phone: true, name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
  });

  app.post('/api/appointments', async (request, reply) => {
    const body = request.body as { phone?: string; startsAt?: string; title?: string; notes?: string; force?: boolean; notify?: boolean };
    const phone = String(body.phone ?? '').replace(/\D/g, '');
    const startsAt = body.startsAt ? new Date(body.startsAt) : null;
    if (phone.length < 7 || !startsAt || Number.isNaN(startsAt.getTime())) return reply.code(400).send({ error: 'phone and startsAt are required' });
    const subscriber = await prisma.subscriber.upsert({ where: { phone }, update: {}, create: { phone, source: 'booking' } });
    try {
      const appointment = await bookSlot({ subscriberId: subscriber.id, startsAt, title: body.title, notes: body.notes, force: body.force });
      let notified: boolean | undefined;
      if (body.notify !== false) {
        const settings = await getSetting('booking');
        const when = describeSlot(startsAt, settings.timezone);
        notified = (await sendMessage({ phone, content: { type: 'text', body: `✅ Tu cita está confirmada para el ${when.date} a las ${when.time}.` }, sender: 'agent' })).ok;
      }
      return reply.code(201).send({ ...appointment, notified });
    } catch (e) {
      if (e instanceof BookingError) {
        const info = bookingErrors[e.code] ?? { status: 400, message: e.code };
        return reply.code(info.status).send({ error: e.code, message: info.message });
      }
      throw e;
    }
  });

  app.patch('/api/appointments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; notes?: string };
    const current = await prisma.appointment.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: 'appointment_not_found' });
    if (body.status && !STATUSES.includes(body.status)) return reply.code(400).send({ error: 'invalid_status', allowed: STATUSES });
    if (body.status && body.status !== 'booked') await cancelAppointment(id, body.status as 'cancelled' | 'completed' | 'no_show');
    return prisma.appointment.update({ where: { id }, data: { notes: body.notes, ...(body.status === 'booked' ? { status: 'booked' } : {}) } });
  });

  app.delete('/api/appointments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await prisma.appointment.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: 'appointment_not_found' });
    await cancelAppointment(id, 'cancelled');
    return { ok: true };
  });
}
