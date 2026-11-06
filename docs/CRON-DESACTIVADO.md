# Cron `cron-tick` desactivado (2026-11-06)

## Qué pasó
- El workflow de GitHub Actions `.github/workflows/cron-tick.yml` corría cada 5 minutos (`*/5 * * * *`) y llamaba a `https://chatsyncs-replica.vercel.app/api/cron/tick`.
- Cada ejecución fallaba y GitHub enviaba un correo ("cron-tick: All jobs have failed") de forma repetida.
- Desactivar el cron de Vercel no lo detenía: son dos cron distintos.

## Causa real del fallo
La respuesta del endpoint era HTTP 500:

```
Invalid `prisma.scheduledJob.findMany()` invocation:
Can't reach database server at aws-0-us-east-1.pooler.supabase.com:6543
```

No era un problema de `CRON_SECRET`: la autenticación pasaba. La base de datos de Supabase no es alcanzable (probablemente proyecto pausado por inactividad en el plan gratuito, o credenciales/pooler cambiados).

## Qué se hizo
- Se comentó el bloque `schedule` en `cron-tick.yml`. Queda solo `workflow_dispatch` (ejecución manual desde la pestaña Actions).
- Ya no se envían correos automáticos.

## Pendiente: el cron diario de Vercel
`vercel.json` aún tiene `"crons": [{ "path": "/api/cron/tick", "schedule": "0 12 * * *" }]`. Corre una vez al día y también fallará mientras la BD esté caída. Si no se quiere usar, borrar esa entrada.

## Cómo reactivar
1. Entrar a Supabase y restaurar/reanudar el proyecto (o corregir `DATABASE_URL` en Vercel). Verificar que la app vuelva a responder.
2. En `cron-tick.yml`, descomentar el bloque `schedule`.
3. Confirmar que existan el secret `CRON_SECRET` y la variable `APP_URL` en GitHub (Settings → Secrets and variables → Actions).
4. Probar con *Run workflow* manual antes de dejar el schedule activo.
