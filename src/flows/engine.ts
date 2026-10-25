import { sendWhatsAppText, sendWhatsAppTemplate } from '../whatsapp/client.js';

export interface FlowStep {
  id: string;
  action: 'send_text' | 'send_template' | 'wait' | 'condition';
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
 * Ejecuta un flujo de chatbot para un suscriptor.
 * Replica simplificada del builder de flujos de ChatSyncs:
 * steps con acciones send_text / send_template / wait / condition.
 */
export async function runFlow(params: { phone: string; flow: Flow }) {
  const sorted = [...params.flow.steps].sort((a, b) => a.order - b.order);
  for (const step of sorted) {
    if (step.action === 'wait') {
      await new Promise((r) => setTimeout(r, Math.max(0, (step.delayDays ?? 0)) * 24 * 60 * 60 * 1000));
      continue;
    }
    if (step.action === 'condition') {
      // condition: { field, operator, value } — si no matchea, se salta al siguiente step
      const cond = step.params ?? {};
      const skip = !(cond as any)?.match;
      if (skip) continue;
    }
    if (step.action === 'send_text') {
      await sendWhatsAppText({ to: params.phone, body: (step.params?.body as string) ?? '' });
    } else if (step.action === 'send_template') {
      await sendWhatsAppTemplate({ to: params.phone, templateName: (step.params?.templateName as string) ?? '' });
    }
  }
}

/**
 * Determina el siguiente paso de entrada del usuario dentro del flujo.
 * Simple: respuestas numéricas / free text avanza al step cuyo order > current.
 */
export function nextUserStep(flow: Flow, currentStepOrder: number): FlowStep | null {
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order);
  for (const step of sorted) {
    if (step.order > currentStepOrder) return step;
  }
  return null;
}
