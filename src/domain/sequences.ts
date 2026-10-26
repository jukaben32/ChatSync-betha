import { prisma } from '../prisma.js';
import { runFlow } from '../flows/engine.js';

export async function enrollSubscriberInSequence(params: { phone: string; sequenceId: string }) {
  const subscriber = await prisma.subscriber.findUnique({ where: { phone: params.phone } });
  if (!subscriber) throw new Error('subscriber_not_found');
  const sequence = await prisma.sequence.findUnique({ where: { id: params.sequenceId } });
  if (!sequence) throw new Error('sequence_not_found');
  const enrollment = await prisma.subscriberSequence.upsert({
    where: { subscriberId_sequenceId: { subscriberId: subscriber.id, sequenceId: sequence.id } },
    update: {},
    create: { subscriberId: subscriber.id, sequenceId: sequence.id },
  });
  return enrollment;
}

export async function triggerSequenceForSubscriber(params: { phone: string; sequenceId: string }) {
  const enrollment = await enrollSubscriberInSequence(params);
  const sequence = await prisma.sequence.findUnique({
    where: { id: params.sequenceId },
    include: { steps: true },
  });
  if (sequence) {
    await runFlow({ phone: params.phone, flow: { id: sequence.id, name: sequence.name, steps: sequence.steps as any } });
  }
  return enrollment;
}

export async function triggerBotFlowForSubscriber(params: { phone: string; flowId: string }) {
  const flow = await prisma.sequence.findUnique({
    where: { id: params.flowId },
    include: { steps: true },
  });
  if (!flow) throw new Error('bot_flow_not_found');
  const result = await runFlow({ phone: params.phone, flow: flow as any });
  return result;
}
