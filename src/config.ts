const PLACEHOLDERS = new Set(['', 'pending', 'set_from_env', 'changeme', 'todo', 'xxx', 'your_token_here']);

/** Lee una variable de entorno; los valores de relleno ("pending", "set_from_env"…) cuentan como no definidos. */
export function env(name: string, fallback = ''): string {
  const value = (process.env[name] ?? '').trim();
  return PLACEHOLDERS.has(value.toLowerCase()) ? fallback : value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/chatsyncs',
  adminApiKey: env('ADMIN_API_KEY'),
  cronSecret: env('CRON_SECRET'),
  whatsapp: {
    businessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: env('WHATSAPP_ACCESS_TOKEN'),
    webhookVerifyToken: env('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    appSecret: env('WHATSAPP_APP_SECRET'),
    baseUrl: process.env.WHATSAPP_BASE_URL ?? 'https://graph.facebook.com/v21.0',
  },
  mcp: {
    enabled: process.env.MCP_ENABLED !== 'false',
    serverUrl: process.env.MCP_SERVER_URL ?? 'http://localhost:8080/mcp',
    apiKey: process.env.MCP_API_KEY ?? '',
  },
};

export function whatsappConfigured() {
  return Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
}
