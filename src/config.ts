export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/chatsyncs',
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  whatsapp: {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'chatsyncs_local_dev',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
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
