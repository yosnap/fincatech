# Prediction Report: fases pendientes del plan `261108-1654-mcp-telegram-edicion-admin`

Alcance: fases 7 (hipoteca), 3 (fecha de gastos), 4 (herramientas + MCP), 5 (agente Telegram), 6 (activación). Fases 1 y 2 ya implementadas.

## Verdict: CAUTION

El diseño es viable y reutiliza bien los servicios existentes. Hay dos supuestos clave que verificar antes de la fase 4 y varias correcciones de diseño baratas que conviene meter en el plan antes de implementar. Nada obliga a rediseñar.

### Evidencia revisada

- `server/middleware/auth.ts`: sesión por cookie global; `/mcp` y el webhook llegan con `user = null` → necesitan su propia autenticación (el plan ya lo prevé).
- `server/utils/rate-limit.ts` + `docs/deployment.md`: una sola réplica obligatoria → el cron en proceso y el rate limit en memoria son válidos.
- `Dockerfile`/`docker-compose.yml`: sin `TZ`; el contenedor corre en UTC. `currentPeriodNow()` usa la hora local del proceso.
- `export-service.ts`, `dashboard-service.ts`, `api/expenses/index.get.ts`: filtran y ordenan gastos por `createdAt`.
- `computeFondoComun`: reparte `Σ salidas / N`; cualquier salida de hipoteca duplicada desplaza el saldo de todos los miembros.

### Agreements (todas las personas)

- Un único registro de herramientas sobre los servicios es la decisión correcta: misma validación, misma auditoría, paridad web garantizada.
- La confirmación previa a escrituras en Telegram es imprescindible y debe vivir en el servidor, no en el modelo.
- La hipoteca como movimientos bancarios reales (no virtuales) es correcta: mantiene el saldo calculado y la conciliación tal cual.

### Conflicts & Resolutions

| Tema | Architect | Security | Performance | UX | Devil's Advocate | Resolución |
|---|---|---|---|---|---|---|
| Relleno retroactivo de la hipoteca | Generar al guardar | — | — | Ver el diálogo después | Si genera antes de borrar, el saldo y el fondo común quedan duplicados mientras el admin no decide | **Previsualizar primero**: al guardar se muestran los meses a crear y los candidatos manuales; generar y borrar los seleccionados en **una sola transacción**. |
| Resumen de confirmación en Telegram | Lo redacta el modelo | El modelo puede describir A y ejecutar B (o sufrir inyección de texto desde notas, títulos de ideas…) | — | Texto natural | — | El resumen lo genera el **servidor** a partir de `tool + input` validado (función `describe()` por herramienta), nunca el texto del modelo. |
| Autenticación MCP con Bearer | Simple | Bien con hash y revocación | — | — | **Supuesto clave**: el conector remoto de claude.ai usa OAuth o sin auth; puede no admitir una cabecera Bearer estática. Claude Code y Claude Desktop (vía `mcp-remote` con `--header`) sí | Verificar con la documentación actual antes de la fase 4. Si claude.ai no admite cabeceras: o bien OAuth mínimo, o bien se limita el criterio de éxito a Claude Desktop/Code. **Decisión del usuario.** |
| Tamaño de la fase 4 (~35 herramientas) | Coherente | — | Cada mensaje del bot envía todos los esquemas: muchos tokens de entrada | — | Empezar por banco/aportes/hipoteca/gastos; tareas, ideas y reservas después | Mantener el alcance aprobado, pero implementar por bloques con verificación por bloque y usar **prompt caching** del bloque de herramientas y del system prompt. |
| Zona horaria | — | — | — | El cargo de un día 1 a las 00:30 en Madrid cae «ayer» en UTC | — | Fijar `TZ=Europe/Madrid` en el contenedor **y** pasar `timezone: 'Europe/Madrid'` a node-cron; las funciones de fecha de hipoteca reciben `today` explícito (testeable). |

### Risk Summary

| Riesgo | Severidad | Señal temprana | Mitigación |
|---|---|---|---|
| Doble contabilización de la hipoteca durante el relleno | High | Saldo calculado distinto del real del banco tras guardar | Previsualizar + generar y borrar en una transacción (ver arriba) |
| El agente ejecuta algo distinto de lo confirmado | High | Audit log con input distinto al resumen mostrado | Resumen generado por el servidor; la acción pendiente guarda el input exacto que se ejecutará |
| Inyección de instrucciones vía datos (notas, títulos, descripciones OCR) | Medium | El bot propone acciones que nadie pidió | Confirmación obligatoria + system prompt que marca los resultados de herramientas como datos + solo admin |
| Conector claude.ai sin soporte para Bearer | Medium | No se puede añadir el conector en claude.ai | Verificar antes; alternativa OAuth o limitar a Desktop/Code |
| La fecha de gasto rompe exportación/estadísticas si queda algún `createdAt` | Medium | Gasto cambiado de fecha aparece en el mes antiguo en el CSV o en el panel | Lista cerrada de usos: `export-service.ts:14-15`, `dashboard-service.ts:84`, `api/expenses/index.get.ts:12`; test de export por fecha |
| Webhook responde 200 y el agente falla después | Low | El usuario no recibe respuesta | try/catch con mensaje de error al chat; el dedupe actual ya evita reprocesar |
| Coste de Claude API | Low | Logs de tokens por mensaje | Prompt caching, máx. 8 iteraciones, rate limit por chat, modelo configurable |
| Cargo automático registrado por un admin dado de baja | Low | — | `registered_by` es solo FK de trazabilidad; aceptable, documentarlo |

### Recommendations

1. **Fase 7**: cambiar el flujo a «previsualizar → confirmar» con generación y borrado de candidatos en una transacción. Así nunca hay una ventana con pagos duplicados.
2. **Fase 7 y 6**: `TZ=Europe/Madrid` en el contenedor, `timezone` en node-cron, y `today` inyectable en `mortgage-core`.
3. **Fase 5**: cada herramienta de escritura define `describe(input)` en el servidor; el mensaje de confirmación usa eso. La acción pendiente guarda el input validado y se ejecuta tal cual.
4. **Fase 5**: aclarar que las fotos de ticket siguen funcionando para propietarios vinculados (ya pueden vincularse hoy) y que solo el texto libre al agente exige admin.
5. **Fase 4**: verificar cómo se autentican hoy los conectores remotos de claude.ai y de Claude Desktop antes de construir `/mcp`; llevar la decisión al usuario si hace falta OAuth.
6. **Fase 4**: implementar las herramientas por bloques (banco/hipoteca → gastos → liquidación → tareas/ideas/propuestas/reservas), con prueba en el inspector MCP al cerrar cada bloque.
7. **Fase 3**: incluir en el plan la lista concreta de usos de `createdAt` que hay que cambiar a `expenseDate`.

## Preguntas abiertas

- Si el conector de claude.ai exige OAuth: ¿implementarlo (más trabajo) o conformarse con Claude Desktop/Claude Code y Telegram?
