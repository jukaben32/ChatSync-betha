/** Celda CSV segura: escapa comillas/separadores y neutraliza fórmulas (=, +, -, @) para que Excel/Sheets no las ejecuten. */
export function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
