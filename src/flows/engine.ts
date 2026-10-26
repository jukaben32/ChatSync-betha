import { prisma } from '../prisma.js';
import { sendAndRecord } from '../domain/messaging.js';

export interface FlowStep {
  id: string;
  action: 'send_text' | 'send_template' | 'wait' | 'condition' | string;
  params?: Record<string, any>;
  delayDays?: number;
  order: number;
}

export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
}

/**
 * Ejecuta un flujo/secuencia para un suscriptor a partir de `startOrder`.
 * Acciones: send_text, send_template, wait, condition, add_label.
 * `wait` (o delayDays > 0) NO bloquea: programa un ScheduledJob que reanuda el flujo
 * desde el siguiente paso cuando llegue la hora (lo procesa /api/cron/tick).
 */
export async function runFlow(params: { phone: string; flow: Flow; startOrder?: number }) {
  const subscriber = await prisma.subscriber.findUnique({ where: { phone: params.phone } });
  if (!subscriber) throw new Error('subscriber_not_found');

  const sorted = [...params.flow.steps].sort((a, b) => a.order - b.order);
  const executed: string[] = [];

  for (const step of sorted) {
    if (params.startOrder !== undefined && step.order < params.startOrder) continue;

    const delayMs = Math.max(0, step.delayDays ?? 0) * 86_400_000 + Math.max(0, Number(step.params?.minutes ?? 0)) * 60_000;
    const isWait = step.action === 'wait';
    // El primer paso reanudado ya esperó su retraso: no se vuelve a programar.
    const alreadyWaited = params.startOrder !== undefined && step.order === params.startOrder;

    if ((isWait || delayMs > 0) && !alreadyWaited && delayMs > 0) {
      await prisma.scheduledJob.create({
        data: {
          subscriberId: subscriber.id,
          sequenceId: params.flow.id,
          resumeOrder: isWait ? step.order + 1 : step.order,
          runAt: new Date(Date.now() + delayMs),
        },
      });
      executed.push(`scheduled:${step.order}`);
      return { ok: true, executed, scheduled: true };
    }
    if (isWait) continue;

    if (step.action === 'condition') {
      const cond = step.params ?? {};
      if (!(cond as any)?.match) continue;
    }

    if (step.action === 'send_text') {
      await sendAndRecord({ phone: params.phone, body: String(step.params?.body ?? '') });
    } else if (step.action === 'send_template') {
      await sendAndRecord({
        phone: params.phone,
        template: { name: String(step.params?.templateName ?? ''), language: step.params?.language, variables: step.params?.variables },
      });
    } else if (step.action === 'add_label') {
      const name = String(step.params?.label ?? '');
      if (name) {
        const label = await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
        await prisma.subscriberLabel.upsert({
          where: { subscriberId_labelId: { subscriberId: subscriber.id, labelId: label.id } },
          update: {},
          create: { subscriberId: subscriber.id, labelId: label.id },
        });
      }
    }
    executed.push(`${step.action}:${step.order}`);
  }
  return { ok: true, executed, scheduled: false };
}

/**
 * Determina el siguiente paso de entrada del usuario dentro del flujo.
 */
export function nextUserStep(flow: Flow, currentStepOrder: number): FlowStep | null {
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order);
  for (const step of sorted) {
    if (step.order > currentStepOrder) return step;
  }
  return null;
}
