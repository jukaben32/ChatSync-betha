import { prisma } from '../prisma.js';

/** Asigna una etiqueta (creándola si no existe). Devuelve true si el contacto no la tenía. */
export async function addLabel(subscriberId: string, name: string): Promise<boolean> {
  const label = await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
  const existing = await prisma.subscriberLabel.findUnique({ where: { subscriberId_labelId: { subscriberId, labelId: label.id } } });
  if (existing) return false;
  await prisma.subscriberLabel.create({ data: { subscriberId, labelId: label.id } });
  return true;
}

export async function removeLabel(subscriberId: string, name: string) {
  const label = await prisma.label.findUnique({ where: { name } });
  if (!label) return;
  await prisma.subscriberLabel.deleteMany({ where: { subscriberId, labelId: label.id } });
}

/**
 * Añade la etiqueta y, si es nueva, inscribe al contacto en las secuencias cuyo disparador es esa etiqueta.
 * La importación de enrollSubscriberInSequence es dinámica para evitar el ciclo labels ↔ sequences ↔ engine.
 */
export async function addLabelWithTriggers(subscriberId: string, name: string) {
  const isNew = await addLabel(subscriberId, name);
  if (!isNew) return false;
  const sequences = await prisma.sequence.findMany({ where: { triggerLabel: name, active: true, kind: 'sequence' } });
  if (!sequences.length) return true;
  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber) return true;
  const { triggerSequenceForSubscriber } = await import('./sequences.js');
  for (const sequence of sequences) {
    await triggerSequenceForSubscriber({ phone: subscriber.phone, sequenceId: sequence.id }).catch(() => undefined);
  }
  return true;
}
