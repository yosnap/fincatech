# Revisión: auto-registro público con aprobación de Admin

## Alcance
- `server/utils/auth.ts`, `server/api/auth/self-register.post.ts`, `server/api/auth/accept-invite.post.ts`, `server/api/auth/bootstrap-admin.post.ts`, `server/api/auth/[...all].ts`
- `server/api/members/index.get.ts`, `server/api/members/[id]/role.patch.ts`
- `server/db/schema/users.ts`, `drizzle/migrations/0013_workable_vin_gonzales.sql`
- `app/pages/register.vue`, `app/pages/login.vue`, `app/layouts/default.vue`, `app/pages/members.vue`, `app/utils/auth-client.ts`

## Crítico

### 1. `POST /api/auth/self-register` no tiene ningún rate limiting real — endpoint público sin protección de abuso
`server/api/auth/self-register.post.ts:27` llama a `auth.api.createUser(...)` como invocación server-side de la API interna de Better Auth, no vía el handler HTTP público. Better Auth documenta explícitamente que las llamadas server-side a `auth.api.*` **no pasan por su rate limiter** (el rate limiting solo aplica a requests que llegan por el router HTTP de Better Auth, es decir, `/api/auth/[...all]`) — esto es así por diseño en Better Auth, no un bug de esta implementación.

Confirmado además que no existe ninguna capa de rate limiting propia en el proyecto: no hay `server/middleware` con throttling, no hay dependencia de captcha/turnstile en `package.json`, y no hay mención de WAF/rate limiting a nivel de infraestructura en `docs/deployment.md`. `self-register.post.ts` tampoco exige token (a diferencia de `accept-invite.post.ts`, protegido por un token de invitación de 32 bytes) ni verifica email (decisión de producto ya aceptada).

Impacto real: un script puede generar cientos/miles de cuentas `guest` con `pendingApproval=true` sin ningún fricción (emails inventados, sin verificación), inundando la cola de `/members`, dificultando que el Admin encuentre las solicitudes legítimas, y creciendo la tabla `users` indefinidamente. No hay exposición de datos financieros (el rol `guest` es de solo lectura sin desglose de deuda), así que no es una fuga de datos, pero sí es un vector de DoS/spam funcional contra el flujo de aprobación que el propio PRD depende de que el Admin pueda gestionar.

**Recomendación**: añadir un rate limit propio por IP (usando el mismo `x-forwarded-for` ya confiado en `trustedProxies`) delante de `self-register.post.ts`, p. ej. un contador simple en Postgres/Redis con ventana deslizante, o reutilizar `auth.rateLimiter` internamente si Better Auth expone un helper público para ello. Como mínimo, limitar por IP + por email a N intentos/hora antes de lanzar a producción pública.

## Alto
Ninguno adicional — el resto de superficies revisadas (integridad de `role`/`pendingApproval`, fuga en mensaje de email duplicado) están correctamente implementadas, ver detalle abajo.

## Medio

### 2. `role.patch.ts` — `pendingApproval=false` no es atómico con `setRole`, puede desincronizarse (no es un problema de seguridad)
`server/api/members/[id]/role.patch.ts:33-41`: `auth.api.setRole(...)` y `db.update(users).set({ pendingApproval: false })` son dos operaciones secuenciales independientes, no envueltas en `db.transaction`. Si el `db.update` fallara tras un `setRole` exitoso (p.ej. corte de conexión), el usuario quedaría con el rol ya elevado pero `pendingApproval=true` residual — el banner de "pendiente de aprobación" (`app/layouts/default.vue:98`) seguiría mostrándose y el badge en `/members` seguiría marcándolo como pendiente, hasta el siguiente cambio de rol.

Confirmado que `pendingApproval` **no participa en ningún gate de autorización** (grep de todos sus usos: solo se lee para UI en `default.vue` y `members.vue`, nunca en `requireRole`/`canSeeIndividualDebt`), así que el peor caso es cosmético/confuso, no un bypass de seguridad. El proyecto ya tolera el mismo patrón secuencial no transaccional en `accept-invite.post.ts` (`db.update(invitations)` + `writeAuditLog` sin tx), así que esto es consistente con el estilo existente, no una regresión aislada. No bloqueante.

### 3. `authClient` no usa `inferAdditionalFields`, dejando un cast evitable en `app/layouts/default.vue:98`
`app/utils/auth-client.ts` registra `adminClient()` (que tipa `role`/`banned` sin casts, según el propio comentario del archivo) pero no registra el plugin `inferAdditionalFields<typeof auth>()` de Better Auth, que es el mecanismo estándar para tipar `additionalFields` (como `pendingApproval`) en `session.user` del lado cliente sin `as`. Esto deja el cast `(session.user as { pendingApproval?: boolean })` en `app/layouts/default.vue:98` como evitable, a diferencia de lo que ya se hizo para `role`/`banned`.

No es un hallazgo de seguridad, es inconsistencia de patrón dentro del propio código nuevo. `register.vue` y `members.vue` **no** tienen este cast (no acceden a `pendingApproval` vía sesión), así que el punto 6 del brief solo aplica a `default.vue`.

## Bajo / Confirmaciones (no son hallazgos, verificación solicitada)

- **Punto 1 (integridad `role`/`pendingApproval` en creación)**: confirmado correcto. `pendingApproval` está marcado `input: false` en `server/utils/auth.ts:38-43`. Más importante: `self-register.post.ts` usa `bodySchema` (zod, `email/password/name` únicamente) para parsear el body — cualquier campo extra que un atacante intente inyectar (p.ej. `data: {pendingApproval:false}` o `role:'admin'`) es descartado por zod antes de construir la llamada a `createUser`, cuyo `role:'guest'` y `data:{pendingApproval:true}` están *hardcodeados* en el propio servidor, no derivados del input del cliente. Revisé también `accept-invite.post.ts` (role viene de la invitación validada en BD, nunca del body del cliente; `pendingApproval` no se especifica y usa el default `false`, correcto — invitaciones quedan aprobadas desde el minuto uno) y `bootstrap-admin.post.ts` (role hardcodeado `'admin'`, `pendingApproval` también usa el default `false`, correcto). No encontré ninguna otra vía server-side ni endpoint (`profile.vue`, `/api/auth/update-user` nativo) donde un usuario pueda influir su propio rol o `pendingApproval`.
- **Punto 3 (fuga en email duplicado)**: confirmado sin fuga obvia. Tanto el fallo de validación zod (400 "Datos inválidos") como el fallo de `createUser` por email duplicado (400 "no se pudo crear la cuenta...") devuelven mensajes genéricos y no distinguibles entre "email no válido" vs "email ya registrado" de forma que confirme existencia. El error real de Postgres/Better Auth solo se registra en `console.error` (servidor), nunca se propaga al cliente.
- **Punto 5 (`members/index.get.ts:21`, cast `as {pendingApproval?: boolean}`)**: confirmado como necesario, no evitable limpiamente. Es una limitación documentada de Better Auth: el tipo de retorno de `auth.api.listUsers` (admin plugin) es `UserWithRole[]` y no incorpora `additionalFields` custom aunque el dato sí viaja en runtime — confirmado por discusión/issue abiertos en el repo de Better Auth (`discussions/2894`, `issues/7982`). El cast es la vía razonable actual.
- **Punto 7 (UX de expectativas)**: adecuado. `register.vue:34-40` ya incluye un `UAlert` explícito ("un administrador debe aprobar tu cuenta antes de que tengas acceso completo") y el toast de éxito repite el mensaje. El banner persistente en `default.vue:94-100` además aclara "tu acceso es de solo lectura". Sin hallazgo.
- Migración `0013_workable_vin_gonzales.sql`: `ALTER TABLE ... DEFAULT false NOT NULL` correcto, sin downtime, backfill implícito de filas existentes a `false`.
- Bloqueo de `/api/auth/admin/*` en `[...all].ts` sigue presente y no fue tocado por este cambio (ver memoria: hallazgo ya resuelto en revisión anterior).

## Recomendación de acción priorizada
1. (Bloqueante antes de exponer públicamente) Añadir rate limiting propio (IP y/o email) a `POST /api/auth/self-register` — punto Crítico #1.
2. (Opcional, no bloqueante) Envolver `setRole` + `pendingApproval=false` en un manejo más defensivo (o aceptar el riesgo documentado) — punto Medio #2.
3. (Opcional, cosmético) Añadir `inferAdditionalFields<typeof auth>()` a `auth-client.ts` para eliminar el cast en `default.vue` — punto Medio #3.

## Preguntas sin resolver
Ninguna — todos los puntos del brief fueron verificados contra el código real.

Status: DONE_WITH_CONCERNS
Summary: La integridad de `role`/`pendingApproval` está correctamente implementada (server-owned, sin vía de escalado por el cliente) y no hay fuga en el mensaje de email duplicado, pero `POST /api/auth/self-register` carece de cualquier rate limiting real — las llamadas server-side a `auth.api.createUser` eluden por diseño el rate limiter de Better Auth y no existe ninguna protección propia — dejando la cola de aprobación abierta a spam/DoS antes de exponerlo públicamente.
