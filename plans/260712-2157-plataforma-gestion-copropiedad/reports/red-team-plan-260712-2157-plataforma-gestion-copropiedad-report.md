# Red-Team Report: Plan Plataforma Gestión Copropiedad (Finca La Unión)

**Fecha:** 2026-07-12
**Método:** `ck:predict` — 5 personas (Architect, Security, Performance, UX, Devil's Advocate)
**Veredicto:** CAUTION (sin bloqueantes)

## Agreements
- Cadena de dependencias entre fases coherente, sin ciclos.
- Motor de deudas (Fase 3) bien diseñado para el riesgo que representa (TX explícitas, céntimos enteros, redondeo determinista, FOR UPDATE + idempotencia).
- RBAC server-side correcto dado que Invitado es actor externo.
- Reuso de `media` genérico entre Fase 7/8 es YAGNI-correcto para esta escala.
- `EXCLUDE USING gist` para reservas es la solución correcta y barata.

## Hallazgos y Resolución

| Hallazgo | Severidad | Resolución aplicada |
|---|---|---|
| Lucia (auth) posiblemente deprecada como librería, adoptada sin verificar | Media | Fase 2: nota de verificación + fallback a Better Auth |
| Dispatcher de notificaciones sin mecanismo de disparo definido | Media | Fase 5 + Fase 1: depende de hosting elegido (Nitro Tasks vs cron externo); nota de posible simplificación YAGNI (envío inline vs outbox) |
| Modelo de acreedor "fondo común" ambiguo entre Fase 3 y Fase 7 | Media-Alta | Fase 3: modelado explícito como usuario sistema (`users`, rol `fondo`); Fase 7 actualizada para solo consumirlo |
| Límites de archivo indefinidos bloqueaban implementación | Baja | Límite provisional aplicado (10MB, JPEG/PNG/PDF) en Fases 3/4/6/7/8, ajustable cuando se resuelva la Pregunta Abierta #2 |
| Estimación de esfuerzo (82h) posiblemente optimista | Baja | No accionado — anotado como orientativo, re-estimar tras Fase 1-2 |

## Preguntas Sin Resolver
- Formato exacto de exportación fiscal (Pregunta Abierta #1 del plan, sin cambios).
- Límite de archivo definitivo (Pregunta Abierta #2, ahora con valor provisional 10MB/JPEG/PNG/PDF en vez de indefinido).

## Siguiente Paso
Entrevista de validación del plan ya corregido.
