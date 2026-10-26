import { prisma } from '../prisma.js';
import { runFlow } from '../flows/engine.js';

export async function enrollSubscriberInSequence(params: { phone: string; sequenceId: string }) {
  const subscriber = await prisma.subscriber.findUnique({ where: { phone: params.phone } });
  if (!subscriber) throw new Error('subscriber_not_found');
  const sequence = await prisma.sequence.findUnique({ where: { id: params.sequenceId } });
  if (!sequence) throw new Error('sequence_not_found');
  return prisma.subscriberSequence.upsert({
    where: { subscriberId_sequenceId: { subscriberId: subscriber.id, sequenceId: sequence.id } },
    update: {},
    create: { subscriberId: subscriber.id, sequenceId: sequence.id },
  });
}

export async function triggerSequenceForSubscriber(params: { phone: string; sequenceId: string }) {
  const enrollment = await enrollSubscriberInSequence(params);
  const sequence = await prisma.sequence.findUnique({ where: { id: params.sequenceId }, include: { steps: true } });
  if (sequence) await runFlow({ phone: params.phone, flow: { id: sequence.id, name: sequence.name, steps: sequence.steps as any } });
  return enrollment;
}

export async function triggerBotFlowForSubscriber(params: { phone: string; flowId: string }) {
  const flow = await prisma.sequence.findUnique({ where: { id: params.flowId }, include: { steps: true } });
  if (!flow) throw new Error('bot_flow_not_found');
  return runFlow({ phone: params.phone, flow: { id: flow.id, name: flow.name, steps: flow.steps as any } });
}

/** Reanuda los pasos programados cuyo runAt ya venció. Lo invoca /api/cron/tick. */
export async function processDueJobs(limit = 50) {
  const jobs = await prisma.scheduledJob.findMany({
    where: { status: 'pending', runAt: { lte: new Date() } },
    include: { subscriber: true, sequence: { include: { steps: true } } },
    orderBy: { runAt: 'asc' },
    take: limit,
  });
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    // reclamar el job para evitar doble ejecución si hay ticks concurrentes
    const claimed = await prisma.scheduledJob.updateMany({ where: { id: job.id, status: 'pending' }, data: { status: 'done' } });
    if (!claimed.count) continue;
    try {
      await runFlow({
        phone: job.subscriber.phone,
        flow: { id: job.sequence.id, name: job.sequence.name, steps: job.sequence.steps as any },
        startOrder: job.resumeOrder,
      });
      done += 1;
    } catch {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: 'failed' } });
      failed += 1;
    }
  }
  return { due: jobs.length, done, failed };
}
