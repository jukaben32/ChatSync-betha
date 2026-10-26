import { prisma } from '../prisma.js';

export type QuestionType = 'text' | 'number' | 'email' | 'phone' | 'date' | 'choice';

export interface Question {
  key: string;
  label: string;
  type: QuestionType;
  options?: string[];
  required?: boolean;
}

export const QUESTION_TYPES: QuestionType[] = ['text', 'number', 'email', 'phone', 'date', 'choice'];

const ERROR_TEXT: Record<QuestionType, string> = {
  text: 'No he entendido tu respuesta, ¿puedes escribirla de nuevo?',
  number: 'Escribe solo un número, por favor.',
  email: 'Ese correo no parece válido, ¿puedes revisarlo?',
  phone: 'Ese teléfono no parece válido; escríbelo con código de país.',
  date: 'Escribe la fecha como DD/MM/AAAA, por ejemplo 25/12/2026.',
  choice: '',
};

/** «Fecha de la cita» → «fecha_de_la_cita» (sin tildes, máx. 40 caracteres) */
export function slugKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'campo'
  );
}

/** Valida y normaliza las preguntas: claves únicas, tipos válidos, opciones para las de elección. */
export function normalizeQuestions(input: unknown): Question[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Añade al menos una pregunta');
  if (input.length > 20) throw new Error('Máximo 20 preguntas por formulario');
  const used = new Set<string>();
  return input.map((raw, i) => {
    const q = raw as Partial<Question>;
    const label = String(q.label ?? '').trim();
    if (!label) throw new Error(`La pregunta ${i + 1} no tiene texto`);
    const type = QUESTION_TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : 'text';
    let key = slugKey(String(q.key ?? '') || label);
    for (let n = 2; used.has(key); n++) key = `${slugKey(String(q.key ?? '') || label).slice(0, 36)}_${n}`;
    used.add(key);
    const options = type === 'choice' ? (q.options ?? []).map((o) => String(o).trim()).filter(Boolean) : undefined;
    if (type === 'choice' && (!options || options.length < 2)) throw new Error(`La pregunta «${label}» necesita al menos 2 opciones`);
    if (options && options.length > 10) throw new Error(`La pregunta «${label}» admite como máximo 10 opciones`);
    return { key, label, type, ...(options ? { options } : {}), required: q.required !== false };
  });
}

export interface CompiledStep {
  action: string;
  params: Record<string, unknown>;
  order: number;
  delayDays: number;
}

/** Convierte un formulario en pasos del motor de flujos: introducción, una pregunta por paso y el cierre. */
export function compileForm(form: { id: string; name: string; intro: string | null; questions: Question[] }): CompiledStep[] {
  const steps: Omit<CompiledStep, 'order' | 'delayDays'>[] = [];
  const hint = 'Puedes escribir «cancelar» en cualquier momento para salir.';
  steps.push({ action: 'send_text', params: { body: `${form.intro?.trim() || `Vamos con «${form.name}».`}\n${hint}` } });

  for (const q of form.questions) {
    if (q.type === 'choice') {
      const options = q.options ?? [];
      if (options.length <= 3) steps.push({ action: 'send_buttons', params: { body: q.label, field: q.key, buttons: options.map((title) => ({ title })) } });
      else steps.push({ action: 'send_list', params: { body: q.label, buttonText: 'Elegir', field: q.key, rows: options.map((title) => ({ title })) } });
    } else {
      steps.push({
        action: 'ask',
        params: {
          body: q.required === false ? `${q.label}\n(Opcional: escribe «omitir» para saltar esta pregunta)` : q.label,
          field: q.key,
          validate: q.type,
          errorText: ERROR_TEXT[q.type],
          optional: q.required === false,
          cancellable: true,
        },
      });
    }
  }
  steps.push({ action: 'submit_form', params: { formId: form.id } });
  return steps.map((s, order) => ({ ...s, order, delayDays: 0 }));
}

/** Crea o actualiza el flujo que ejecuta el formulario. Devuelve el id del flujo. */
export async function syncFormFlow(form: { id: string; name: string; keyword: string | null; intro: string | null; questions: unknown; active: boolean; sequenceId: string | null }) {
  const steps = compileForm({ id: form.id, name: form.name, intro: form.intro, questions: form.questions as Question[] });
  const data = {
    name: `📋 ${form.name}`,
    kind: 'flow',
    folder: 'Formularios',
    triggerKeyword: form.keyword?.trim() || null,
    matchType: 'contains',
    active: form.active,
  };
  if (form.sequenceId) {
    const existing = await prisma.sequence.findUnique({ where: { id: form.sequenceId } });
    if (existing) {
      await prisma.sequenceStep.deleteMany({ where: { sequenceId: existing.id } });
      await prisma.sequence.update({ where: { id: existing.id }, data: { ...data, steps: { create: steps.map((s) => ({ ...s, params: s.params as never })) } } });
      return existing.id;
    }
  }
  const created = await prisma.sequence.create({ data: { ...data, steps: { create: steps.map((s) => ({ ...s, params: s.params as never })) } } });
  await prisma.form.update({ where: { id: form.id }, data: { sequenceId: created.id } });
  return created.id;
}
