/** Bloquea destinos internos para peticiones salientes configurables (HTTP en flujos, URLs de conocimiento…). */
export function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === '::1' ||
    h === '[::1]' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h)
  );
}

export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('url_protocol_not_allowed');
  if (isPrivateHost(url.hostname)) throw new Error('url_host_not_allowed');
  return url;
}

/** Lee un valor anidado: "customer.name", "items.0.sku". */
export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);
}
