# ChatSyncs Replica (privada)

Réplica privada de **ChatSyncs** (https://www.chatsyncs.com/) para uso personal y de mis proyectos.
Sin pagos, planes ni facturación. Producción: https://chatsyncs-replica.vercel.app

## Qué incluye

| Módulo | Estado |
|---|---|
| Bandeja compartida: asignación (manual o reparto equitativo), notas, seguimiento, archivar, respuestas rápidas, aviso de ventana de 24 h | ✅ |
| IA para el equipo: sugerir respuesta, mejorar redacción, Subscriber IQ | ✅ requiere `AI_API_KEY` |
| Contactos: etiquetas, campos personalizados, importación CSV, bloqueo y baja (`STOP`) | ✅ |
| Flujos de chatbot con ramas: botones, listas, preguntas validadas, condiciones, HTTP, esperas | ✅ |
| Secuencias drip: inscripción por etiqueta, se detienen al responder | ✅ |
| Broadcasts: segmentación (etiquetas, exclusiones, campos), imagen, botones, programación, entrega/lectura | ✅ |
| Webhook Workflows entrantes (URL propia, mapeo de campos, condiciones, retraso, acciones) | ✅ |
| Plantillas de WhatsApp (crear, enviar a Meta, sincronizar) | ✅ |
| Agente IA: base de conocimiento (texto, web, Google Sheets), acciones sobre el contacto, traspaso a humano | ✅ requiere `AI_API_KEY` |
| Horario comercial por día, aviso fuera de horario | ✅ |
| CRM (pipeline), analítica, orígenes de leads | ✅ |
| Webhooks salientes firmados, API keys con permisos y registro de uso | ✅ |
| Servidor MCP por HTTP (`/api/mcp`, 35 herramientas reales) | ✅ |
| Modo simulación y consola de pruebas (probar todo sin WhatsApp) | ✅ |
| WhatsApp Cloud API real | ⏳ faltan credenciales de Meta; nada se ha probado contra Meta |

Qué falta respecto a ChatSyncs y por qué: [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md). Sin pagos, pedidos ni catálogo (uso privado).

## Arquitectura

- **Backend:** Fastify + Prisma (PostgreSQL en Supabase), en `src/`. En Vercel corre como función (`api/index.ts`).
- **Panel:** React + Vite en `frontend/`; el build se escribe en `public/`.
- **Auth:** todo `/api/*` exige `Authorization: Bearer <ADMIN_API_KEY>` (o una API key creada en el panel). Públicos: `/api/health`, `/api/whatsapp/webhook` (verify token + firma de Meta) y `/api/cron/*` (`CRON_SECRET`).
- **Tareas programadas:** Vercel Cron llama a `/api/cron/tick` una vez al día (límite del plan gratuito). Para esperas y broadcasts programados con precisión de minutos, `.github/workflows/cron-tick.yml` lo llama cada 5 minutos (define el secreto `CRON_SECRET` y la variable `APP_URL` en GitHub).
- **MCP:** `claude mcp add --transport http chatsyncs https://<tu-dominio>/api/mcp --header "Authorization: Bearer <clave>"`.

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
| `ALLOW_UNSIGNED_WEBHOOKS` | Solo desarrollo local: acepta webhooks de Meta sin firma |

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

## Pruebas

```bash
npm test                                   # unitarias (motor de flujos, horario, alcance de claves…)
BASE=https://chatsyncs-replica.vercel.app KEY=<ADMIN_API_KEY> node scripts/smoke.mjs   # end-to-end contra un despliegue
```

La prueba de humo activa el modo simulación, recorre los flujos principales (incluido el MCP) y deja todo como estaba.

## Despliegue

`git push` a `main` despliega en Vercel (`npm run build:all`: Prisma + TypeScript + build del panel).
