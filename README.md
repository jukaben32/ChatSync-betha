# ChatSyncs Replica (privada)

Réplica privada de **ChatSyncs** (https://www.chatsyncs.com/) para uso personal y de mis proyectos.
Sin pagos, planes ni facturación. Producción: https://chatsyncs-replica.vercel.app

## Qué incluye

| Módulo | Estado |
|---|---|
| Bandeja compartida (asignación, estados, notas internas) | ✅ |
| Contactos, etiquetas, importación CSV, bloqueo y baja | ✅ |
| Broadcasts con seguimiento sent → delivered → read | ✅ |
| Flujos de chatbot por palabra clave + secuencias drip (`wait` programado) | ✅ |
| Plantillas de WhatsApp (crear, enviar a Meta, sincronizar) | ✅ |
| Agente IA (base de conocimiento, herramientas, traspaso a humano) | ✅ requiere `AI_API_KEY` |
| CRM (pipeline de oportunidades) | ✅ |
| Webhooks salientes firmados (HMAC) y API keys REST | ✅ |
| Analítica (mensajes por día, entrega/lectura, pipeline) | ✅ |
| Servidor MCP (herramientas para agentes) | ✅ |
| WhatsApp Cloud API real | ⏳ faltan credenciales de Meta |

## Arquitectura

- **Backend:** Fastify + Prisma (PostgreSQL en Supabase), en `src/`. En Vercel corre como función (`api/index.ts`).
- **Panel:** React + Vite en `frontend/`; el build se escribe en `public/`.
- **Auth:** todo `/api/*` exige `Authorization: Bearer <ADMIN_API_KEY>` (o una API key creada en el panel). Públicos: `/api/health`, `/api/whatsapp/webhook` (verify token + firma de Meta) y `/api/cron/*` (`CRON_SECRET`).
- **Tareas programadas:** Vercel Cron llama a `/api/cron/tick` una vez al día y reanuda los pasos `wait`.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Pooler de Supabase (puerto 6543, `?pgbouncer=true&connection_limit=1`) |
| `ADMIN_API_KEY` | Clave de acceso al panel y a la API |
| `CRON_SECRET` | Protege `/api/cron/tick` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API |
| `WHATSAPP_APP_SECRET` | Valida la firma `X-Hub-Signature-256` de Meta |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token que pones en Meta al registrar el webhook |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Agente IA (OpenAI-compatible / OpenRouter) |

Los valores de relleno (`pending`, `set_from_env`…) se tratan como no definidos.

## Conectar WhatsApp

1. En Meta for Developers → tu app → WhatsApp → Configuración → Webhook.
2. URL: `https://chatsyncs-replica.vercel.app/api/whatsapp/webhook`, token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Suscríbete al campo `messages`.
4. Define las variables de WhatsApp en Vercel y redespliega.

## Base de datos

El esquema vive en `prisma/schema.prisma`; el SQL equivalente en `prisma/sql/` (`001_init.sql`, `002_features.sql`), aplicable desde el SQL Editor de Supabase. Para un cambio nuevo:

```bash
npx prisma migrate diff --from-schema-datamodel <schema_anterior> --to-schema-datamodel prisma/schema.prisma --script
```

## Desarrollo local

```bash
cp .env.example .env        # DATABASE_URL, ADMIN_API_KEY…
npm install
npm run dev                 # API en :8080
npm --prefix frontend ci && npm --prefix frontend run dev   # panel en :5173 (proxy a :8080)
```

## Despliegue

`git push` a `main` despliega en Vercel (`npm run build:all`: Prisma + TypeScript + build del panel).
