# Cron desactivado: /api/cron/tick

**Fecha:** 29-oct-2026
**Motivo:** el equipo de Vercel se pausó por superar el límite gratuito de *Fluid Active CPU* (4 h al mes). Se desactivó el cron para no sumar consumo mientras se investiga la causa.

## Qué se desactivó

En `vercel.json` se quitó esta línea dentro del objeto principal:

```json
"crons": [{ "path": "/api/cron/tick", "schedule": "0 12 * * *" }],
```

- Ruta: `/api/cron/tick`
- Horario original: todos los días a las 12:00 UTC (8:00 a. m. en República Dominicana).
- Qué hace: procesa trabajos programados, broadcasts programados, seguimientos inteligentes y caduca sesiones de flujo de más de 24 h.

El código de la ruta (`src/api/routes-settings.ts`) **no se tocó**. Sigue funcionando si alguien la llama con `Authorization: Bearer $CRON_SECRET`.

## Cómo restablecerlo

Opción 1 (la más simple): revertir el commit de esta rama.

```bash
git revert <id-del-commit>
```

Opción 2: volver a poner la línea en `vercel.json`, dentro del objeto principal, después de `"functions"`:

```json
"crons": [{ "path": "/api/cron/tick", "schedule": "0 12 * * *" }],
```

Luego hacer commit y push. Vercel vuelve a programar el cron en el siguiente despliegue de producción.

## Nota

Esto solo surte efecto cuando el cambio llega a producción (merge a `main` y despliegue). Mientras el equipo esté pausado, ningún cambio se despliega.
