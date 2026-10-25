# Despliegue en Supabase

## Arquitectura objetivo

- **Base de datos:** Supabase Postgres (PostgreSQL 15/16).
- **App:** contenedor Node (Fastify) desplegado en un host que soporte Docker (Supabase Container / Railway / Render / Fly / Azure Container Apps).

## Variables de entorno (producción)

```env
DATABASE_URL=<SUPABASE_DB_CONNECTION_STRING>
PORT=8080
WHATSAPP_BUSINESS_ACCOUNT_ID=<...>
WHATSAPP_PHONE_NUMBER_ID=<...>
WHATSAPP_ACCESS_TOKEN=<...>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<...>
WHATSAPP_APP_SECRET=<...>
WHATSAPP_BASE_URL=https://graph.facebook.com/v21.0

AI_AGENT_ENABLED=true|false
AI_BASE_URL=<https://openrouter.ai/api/v1 | ...>
AI_API_KEY=<...>
AI_MODEL=<...>
AI_MAX_ITERATIONS=<6>

MCP_ENABLED=true
MCP_SERVER_URL=<...>
MCP_API_KEY=<...>
```

> Nota: la `anon public key` de Supabase (`https://xygmcdpwuxujslhcbefl.supabase.co`) es la API REST/invitaciones de Supabase. Para Prisma/Postgres se necesita la **connection string** del pooler, con formato:
> `postgresql://postgres:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`

## Deploy con Docker (Supabase Deploy Button o cualquier registry)

1. El repositorio incluye `Dockerfile` + `.dockerignore`.
2. Build: `docker build -t chatsyncs-replica .`
3. Run: `docker run -p 8080:8080 --env-file .env chatsyncs-replica`
4. Ejecutar migraciones: `npx prisma migrate deploy` (o `prisma migrate dev` en staging).

## Deploy en Supabase (Container)

- Usar **Supabase Deploy Button** apuntando al repo con Dockerfile, o
- Conectar repo GitHub → **Deployments → New** → tipo *Container* con el Dockerfile.

## Webhooks de WhatsApp (Meta)

- `GET /api/whatsapp/webhook` → verificación (hub.verify_token).
- `POST /api/whatsapp/webhook` → eventos inbound + status.
- Registrar `https://<dominio>/api/whatsapp/webhook` en Meta App → WhatsApp → Configuration.

## MCP

- `POST/GET /mcp` → servidor MCP (Streamable HTTP) con las 43 tools.

## Deploy en Vercel (alternativa a Railway)

- El backend se expone como función serverless en `api/index.ts` usando el builder `@vercel/node`.
- `vercel.json` define el build y la route catch-all hacia `api/index.ts`.
- `src/app.ts` exporta la instancia de Fastify (sin `listen`) para reutilizarla en el handler serverless.
- Variables de entorno: igual que en Docker (ver arriba).

```bash
vercel deploy --yes
```

