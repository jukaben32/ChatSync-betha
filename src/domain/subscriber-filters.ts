/** Filtros del listado de contactos (también los usan la exportación y las acciones masivas). */
export function subscriberWhere(q: { q?: string; label?: string; list?: string; sequence?: string; status?: string }) {
  const where: any = {};
  if (q.q) {
    where.OR = [
      { phone: { contains: q.q } },
      { name: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  if (q.label) where.labels = { some: { label: { name: q.label } } };
  if (q.list) where.lists = { some: { list: { name: q.list } } };
  if (q.sequence) where.sequences = { some: { sequenceId: q.sequence, status: 'active' } };
  if (q.status === 'subscribed') Object.assign(where, { blocked: false, optedOut: false });
  if (q.status === 'unsubscribed') where.optedOut = true;
  if (q.status === 'blocked') where.blocked = true;
  return where;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un contacto se puede indicar por teléfono o por id: el panel usa el id para que los agentes no necesiten ver el número. */
export function subRef(ref: string): { id: string } | { phone: string } {
  return UUID.test(ref) ? { id: ref } : { phone: ref };
}
