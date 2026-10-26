import { prisma } from '../prisma.js';

export interface DayHours {
  enabled: boolean;
  start: string; // "09:00"
  end: string; // "18:00"
}

export interface BusinessHours {
  enabled: boolean;
  timezone: string;
  days: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>;
  /** Respuesta automática fuera de horario. */
  offHoursMessage: string;
  /**
   * message = fuera de horario solo se envía el aviso (el bot calla)
   * bot_only_off_hours = el bot/IA responde solo fuera de horario; en horario atienden personas
   * ignore = el horario no afecta al bot
   */
  offHoursBehavior: 'message' | 'bot_only_off_hours' | 'ignore';
}

export interface AiSettings {
  /** all = la IA atiende todos los mensajes (y puede lanzar flujos) · fallback = solo si ninguna palabra clave de flujo aplica */
  mode: 'all' | 'fallback';
  delaySeconds: number;
  escalateOnNegative: boolean;
  restrictedTopics: string;
  autoActions: boolean;
}

export interface AgentSettings {
  /** Texto que se añade al final de los mensajes que envían las personas del equipo. */
  signature: string;
  /** Idioma al que se traducen los mensajes del cliente en la bandeja (código ISO, p. ej. "es"). */
  translateLanguage: string;
}

export interface SandboxSettings {
  /** Modo simulación: sin WhatsApp configurado, los mensajes se guardan como enviados sin llamar a Meta. */
  enabled: boolean;
}

export interface AssignmentSettings {
  mode: 'manual' | 'round_robin';
}

const DEFAULT_DAY: DayHours = { enabled: true, start: '09:00', end: '18:00' };

export const DEFAULTS: { businessHours: BusinessHours; ai: AiSettings; assignment: AssignmentSettings; sandbox: SandboxSettings; agent: AgentSettings } = {
  businessHours: {
    enabled: false,
    timezone: 'America/Santo_Domingo',
    days: {
      mon: DEFAULT_DAY,
      tue: DEFAULT_DAY,
      wed: DEFAULT_DAY,
      thu: DEFAULT_DAY,
      fri: DEFAULT_DAY,
      sat: { enabled: false, start: '09:00', end: '13:00' },
      sun: { enabled: false, start: '09:00', end: '13:00' },
    },
    offHoursMessage: 'Gracias por escribirnos. Ahora estamos fuera de horario; te responderemos en cuanto abramos.',
    offHoursBehavior: 'ignore',
  },
  ai: { mode: 'fallback', delaySeconds: 0, escalateOnNegative: true, restrictedTopics: '', autoActions: true },
  assignment: { mode: 'manual' },
  sandbox: { enabled: false },
  agent: { signature: '', translateLanguage: 'es' },
};

export type SettingKey = keyof typeof DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return DEFAULTS[key];
  return { ...DEFAULTS[key], ...(row.value as object) } as (typeof DEFAULTS)[K];
}

export async function setSetting(key: SettingKey, value: unknown) {
  await prisma.setting.upsert({ where: { key }, update: { value: value as any }, create: { key, value: value as any } });
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** ¿Está abierto ahora según el horario por día y la zona horaria configurada? Sin horario activado, siempre abierto. */
export function isOpenNow(hours: BusinessHours, now = new Date()): boolean {
  if (!hours.enabled) return true;
  let weekday = 'mon';
  let hhmm = '00:00';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    weekday = get('weekday').toLowerCase().slice(0, 3);
    hhmm = `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
  } catch {
    weekday = DAY_KEYS[now.getUTCDay()];
    hhmm = now.toISOString().slice(11, 16);
  }
  const day = hours.days[weekday as keyof BusinessHours['days']];
  if (!day?.enabled) return false;
  return hhmm >= day.start && hhmm < day.end;
}
