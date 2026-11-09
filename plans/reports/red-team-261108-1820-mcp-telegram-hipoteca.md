# Red Team: plan `261108-1654-mcp-telegram-edicion-admin`

Fecha: 2026-11-08. Revisores: Seguridad (opus), Modos de fallo (sonnet), Supuestos + Alcance (fable). Tres revisores en vez de cuatro por la norma global de fan-out máximo 3. Se recibieron 28 hallazgos; tras quitar duplicados quedan 15 aceptados y 1 rechazado. Las afirmaciones clave se verificaron a mano en el código.

## Hallazgos consolidados

| # | Hallazgo | Severidad | Disposición | Aplica a |
|---|---|---|---|---|
| 1 | La autorización del bot va por chat y no por usuario: un grupo vinculado da poderes de admin a todos (`telegram.post.ts:15-22,47`) | Critical | Accept | Fase 5 |
| 2 | `/link` se ha convertido en credencial de admin: token en claro, consumo no atómico y reasignación silenciosa de chat (`telegram.post.ts:79-90`) | High | Accept | Fase 5 |
| 3 | Falso que «las reglas se hereden del servicio»: la elegibilidad de participantes, los topes de importe y los refine están en los endpoints (`participants.patch.ts:26-30`, `transactions/[id].patch.ts:6-18`) | High | Accept | Fase 4 |
| 4 | Tareas e ideas no tienen servicio; hay unos 12 handlers que extraer y no figuran en la fase ni en la estimación | Medium | Accept | Fase 4 |
| 5 | `channel` en la auditoría no se consigue tocando solo `audit.ts` (38 llamadas); hace falta `AsyncLocalStorage` y un valor `system` para el cron | High | Accept | Fases 4 y 7 |
| 6 | La comprobación de duplicados está fuera de la transacción (carrera de doble envío) y `force` quedaría expuesto al modelo (`contribution-service.ts:77-90`) | High | Accept | **Fase 1 (código hecho)** y fase 4 |
| 7 | Exfiltración sin clic mediante vistas previas de enlaces y Markdown; además, mensajes de más de 4096 caracteres o con entidades rotas fallan en silencio (`telegram-bot.ts:17`) | High | Accept | Fase 5 |
| 8 | El agente necesita estados `pending→executing→done/failed`, serialización por chat, el resultado de la confirmación de vuelta en la memoria y volver a comprobar el rol al confirmar | High | Accept | Fase 5 |
| 9 | Borrar los pagos manuales de la hipoteca destruye sus justificantes y el borrado múltiple no es atómico (`bank-service.ts:185-226`) | High | Accept, **decisión del usuario**: adoptar o borrar | Fase 7 |
| 10 | El relleno de la hipoteca pisa ediciones manuales; la marca de agua depende de una fila `global` que puede no existir; `effective_from` no tiene límite (cientos de cargos) | High | Accept | Fase 7 |
| 11 | `expense_date NOT NULL` sin default rompe el rollback; el backfill con `::date` en UTC cambia de día los gastos nocturnos | High | Accept | Fase 3 |
| 12 | La liquidación y el panel siguen usando `debt.createdAt` / `Date`; la columna `date` devuelve string (`settlement-core.ts:96,114`, `dashboard-service.ts:84`, `export-service.ts:12-15`) | High | Accept | Fase 3 |
| 13 | La fecha del OCR no tiene formato garantizado y `confirm*.post.ts` no la acepta; faltan las pantallas de revisión en la lista de ficheros | Medium | Accept | Fase 3 |
| 14 | `marcar_deuda_pagada` solo funciona para el propio deudor (`expense-service.ts:126`); sin operación propia invita a suplantar el `actorId` | Medium | Accept, **decisión del usuario** | Fase 4 |
| 15 | `scripts/telegram-set-webhook.ts` no existe en la imagen y obligaría a copiar el token de producción en local (`Dockerfile:23-25`) | High | Accept | Fase 6 |
| R1 | Los tokens MCP no caducan | Medium | Reject | Superado por la decisión de OAuth (tokens de vida corta y comprobación del rol por petición ya en la fase 4) |

## Cambios propuestos por fase (si se aceptan)

- **Fase 1 (corrección):** mover la comprobación de duplicados dentro de la transacción con `pg_advisory_xact_lock` sobre (miembro, tipo, fecha, importe).
- **Fase 3:** `expense_date` con `DEFAULT CURRENT_DATE` y backfill `(created_at AT TIME ZONE 'Europe/Madrid')::date`; liquidación, panel y exportación por `expenseDate` como string; validar la fecha del OCR y añadir `new-from-ticket.vue` y `from-telegram.vue` a la lista.
- **Fase 4:** paso previo para extraer los esquemas zod y las reglas de los endpoints a módulos compartidos, y crear `task-service.ts` e `idea-service.ts`; `AsyncLocalStorage` para el canal; `force` nunca en el `inputSchema`; `listar_miembros` solo con id y nombre; reestimar la fase.
- **Fase 5:** solo `chat.type = private`, `from.id` guardado y comparado en mensajes y callbacks; consumo atómico y token hasheado en `/link`, aviso al cambiar de chat; texto plano o HTML escapado, sin vistas previas, troceo en 4000 caracteres; máquina de estados, cola por chat, resultado en la memoria y nueva comprobación del rol al confirmar.
- **Fase 6:** sustituir el script por un botón «Activar Telegram» en la web (admin) que llama a `setWebhook` y `setMyCommands` desde el servidor y muestra el estado de `getWebhookInfo`.
- **Fase 7:** el relleno solo crea meses que faltan y nunca modifica cargos existentes; editar un cargo automático lo convierte en manual; marca de agua con upsert; `effective_from >= 2026-09`; `configurar_hipoteca` clasificada como `destructive`, con el número de cargos en la confirmación; candidatos en una sola transacción y mostrando si tienen justificante.
