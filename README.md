# ChatSyncs Replica (privada)

Réplica privada de las funcionalidades de **ChatSyncs** (https://www.chatsyncs.com/) construida a partir del análisis inverso con **REA** (https://github.com/morluto/rea).

Objetivo: tener una app con las mismas funcionalidades de WhatsApp automation para uso privado (sin pagos, sin SaaS).

## Estado actual

- [x] Inventario de funcionalidades capturado con REA (ver `docs/CHATSYNC_FEATURES.md`).
- [x] Scaffold backend (Fastify + Prisma/Postgres) + capa WhatsApp Cloud API.
- [x] Webhook WhatsApp + API REST + MCP server (43 tools).
- [x] Motor de flujos de chatbot + handler inbound/outbound.
- [x] AI agent (tool-calling loop) + herramientas WhatsApp (send, contacts, labels, sequences, orders, CRM, broadcasts).
- [x] `tsc --noEmit` pasa sin errores.

## Fases

1. Backend + WhatsApp Cloud API. ✅
2. Inbox compartido + contacts/labels/notes. ⬜
3. Broadcast + bot flows + sequences. ✅ (scaffold + send/enroll)
4. AI agents (tool loop) + MCP server + REST API. ✅ (tool loop scaffold)
5. Catalog/orders/CRM. ⬜
6. Dashboard UI. ⬜

## Próximos pasos sugeridos

1. `prisma migrate dev` contra Postgres local (docker compose).
2. Levantar servidor + registrar webhook en Meta.
3. Conectar dashboard (inbox/broadcasts/flows/agents).
4. Integrar agente de IA en el loop inbound (persistir tool results en conversaciones).

## Deploy

- **Vercel:** `vercel.json` + `api/index.ts` + `src/app.ts` listos. Ver `docs/DEPLOYMENT.md`.
- **Supabase Postgres + Docker:** `Dockerfile` + `docker-compose.yml` + `docs/DEPLOYMENT.md`.

```bash
# Vercel
vercel deploy --yes

# Docker
docker build -t chatsyncs-replica .
docker run -p 8080:8080 --env-file .env chatsyncs-replica
```
