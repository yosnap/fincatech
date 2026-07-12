# Revisión Fase 2 — Auth y RBAC 3 roles

**Plan:** `plans/260712-2157-plataforma-gestion-copropiedad/phase-02-auth-y-rbac-3-roles.md`
**Alcance revisado:** server/db/schema/{users,auth,invitations,audit-log}.ts, server/utils/{auth,rbac,permissions,audit,email,env}.ts, server/middleware/auth.ts, server/api/auth/*, server/api/members/*, app/pages/{login,accept-invite,members,profile}.vue, app/middleware/{auth,admin}.ts, app/composables/use-auth.ts, app/utils/auth-client.ts, app/layouts/default.vue, migración 0001.

No repito los checks ya confirmados manualmente por el autor (bootstrap→disable, invite→accept flow, 401/403/200 por rol, token de un solo uso, audit_log con actor_id, typecheck/lint limpios) salvo donde encontré evidencia de que están incompletos.

---

## Crítico

### 1. Los endpoints nativos del plugin `admin` de Better Auth quedan expuestos sin auditoría ni las reglas de negocio de la app

`server/api/auth/[...all].ts:7-9` monta `auth.handler` completo. Al registrar el plugin `admin` en `server/utils/auth.ts:30-37` con `ac`/`adminRole` heredando `adminAc.statements` (`server/utils/permissions.ts:11`), Better Auth auto-monta rutas REST propias bajo `/api/auth/admin/*` — confirmado contra la documentación oficial: `set-role`, `ban-user`, `create-user`, `impersonate-user`, `remove-user`, `unban-user`, `list-users`, `revoke-user-session(s)`, todas protegidas solo por el chequeo interno de Better Auth (rol `admin` o permiso `ac`), **no** por la lógica de esta app.

Esto significa que cualquier sesión con `role: admin` puede, llamando directamente a esas rutas en vez de pasar por `server/api/members/*`:

- **Saltarse `audit_log` por completo.** `writeAuditLog` solo se invoca desde los wrappers `server/api/members/*` (`role.patch.ts:31-37`, `deactivate.post.ts:21-26`, `invite.post.ts:35-41`) y desde `accept-invite`/`bootstrap-admin`. Los endpoints nativos de Better Auth no escriben nada en `audit_log`. Esto incumple directamente el Success Criterion del plan: *"Cada acción sensible deja registro en audit_log con actor+timestamp"* y la Architecture note *"audit_log escrito dentro de la misma transacción que la mutación"*.
- **Saltarse el guard anti-autobloqueo.** `role.patch.ts:16-18` y `deactivate.post.ts:11-13` bloquean que un admin se cambie el rol o se dé de baja a sí mismo — pero esa validación vive solo en el wrapper de la app. `POST /api/auth/admin/set-role` o `/admin/ban-user` con el propio `userId` del admin no tienen ese chequeo en Better Auth.
- **Saltarse el flujo de invitación.** `POST /api/auth/admin/create-user` crea usuarios directamente (sin invitación, sin `invitations` row, sin auditoría), en paralelo a `accept-invite.post.ts`.
- **Impersonación sin rastro.** `POST /api/auth/admin/impersonate-user` está activo y sin auditar — un admin puede asumir la sesión de cualquier owner/guest sin dejar registro. Dado que el PRD trata la fuga/uso indebido de datos de un condominio como incidente de privacidad, esto es una superficie de riesgo real, no cosmética. El comentario en `server/db/schema/auth.ts:11` ("no se usa activamente aún") es impreciso: la ruta está viva vía el catch-all aunque la columna `impersonatedBy` no se consulte en la app.

**Evidencia:** `server/api/auth/[...all].ts:1-9`, `server/utils/auth.ts:30-37`, `server/utils/permissions.ts:9-13`, comparado contra la documentación oficial del plugin admin (better-auth.com/docs/plugins/admin) que confirma que estas rutas se auto-montan y solo exigen rol/permiso admin.

**Fix sugerido:** bloquear `/api/auth/admin/*` en el middleware o en el catch-all (forzando que toda mutación de admin pase por `server/api/members/*`, tal como indica el propio diagrama de arquitectura del plan: `requireRole → handler → capa de datos`), o mover la auditoría/reglas de autobloqueo a `databaseHooks` de Better Auth (`user.update.before/after`, `session.create.after` para impersonación) para que apliquen sin importar qué ruta se golpee.

---

## Alto

### 2. Condición de carrera real en `bootstrap-admin.post.ts`

`server/api/auth/bootstrap-admin.post.ts:16-18`: el gate es `db.query.users.findFirst()` (SELECT) seguido, sin transacción ni lock, de `auth.api.createUser` (INSERT). Dos requests concurrentes con emails distintos pueden pasar ambas el chequeo "no existe ningún usuario" antes de que cualquiera de las dos confirme el insert, resultando en **dos "primeros admin" independientes** — se rompe la invariante de "solo un bootstrap, luego permanentemente inutilizable". La ventana de explotación es justo el momento de mayor riesgo: el hueco entre el deploy y el primer login del operador, si el endpoint es alcanzable en red antes de ese momento.

No lo mitiga el unique constraint de `email` (`users_email_unique`), porque el ataque usa dos emails distintos.

**Fix sugerido:** envolver el check+create en una transacción serializable, o `pg_advisory_xact_lock`, o una fila-centinela `bootstrap_completed` con constraint único que se inserte atómicamente como parte del mismo insert de usuario.

(Nota: la race equivalente en `accept-invite.post.ts:22-49` —check de `usedAt` seguido de `auth.api.createUser`— **no** es explotable de la misma forma: como el email de la invitación es fijo, una segunda ejecución concurrente choca contra el unique constraint de `users.email` y cae en el `catch` de la línea 43, devolviendo 400. Es un diseño frágil pero no una vulnerabilidad activa; ver hallazgo Bajo #6.)

---

## Medio

### 3. Casts inseguros `as { role?: string }` / `as { banned?: boolean }` duplicados en 5 archivos

`server/middleware/auth.ts:9-10`, `server/api/members/index.get.ts:17-18`, `app/middleware/admin.ts:4`, `app/pages/profile.vue:47`, `app/layouts/default.vue:10`. Cada uno castea el `user` de la sesión de Better Auth de forma local en vez de usar un tipo único derivado de `auth.$Infer.Session` (que Better Auth infiere automáticamente incluyendo los campos añadidos por el plugin `admin`: `role`, `banned`, etc.). Si el nombre de campo cambia o se reconfigura el plugin, hay que actualizar 5 sitios a mano sin que TypeScript avise en los que se olviden.

**Fix sugerido:** exportar un tipo `AuthUser = typeof auth.$Infer.Session.user` (o equivalente) desde `server/utils/auth.ts`/`app/utils/auth-client.ts` y reutilizarlo en los 5 puntos.

### 4. `app/layouts/default.vue:4` usa `authClient.useSession()` sin `useFetch` → mismatch de hidratación

El propio equipo ya identificó y corrigió este problema en `app/middleware/auth.ts`/`admin.ts` (creando `useAuth()` request-scoped) porque el cliente singleton no reenvía cookies en SSR. Pero `default.vue` sigue usando el singleton `authClient.useSession()` sin pasar `useFetch`, que según la documentación oficial de Better Auth para Nuxt no reenvía cookies en SSR salvo que se le pase `useFetch` explícitamente. Efecto: en cada carga SSR de una página autenticada, la navbar se renderiza inicialmente como "no logueado" (solo botón "Entrar", sin "Miembros"/"Mi perfil") y cambia tras la hidratación en cliente — root cause del mismo bug de SSR que ya se corrigió en otros dos archivos, pero no aquí.

**Fix sugerido:** usar el mismo patrón `authClient.useSession(useFetch)` documentado (como en `profile.vue:6`) o el composable `useAuth()` con `useAsyncData`.

### 5. Success Criterion del plan sin cumplir: no existe test de integración

El plan exige explícitamente: *"Guest autenticado recibe 403/datos agregados al pedir desglose individual (**verificado por test de integración**)"*. `find` sobre el repo no encuentra ningún `*.test.*`/`*.spec.*`, y `package.json` no tiene script `test` ni runner configurado. Todo lo verificado fue manual vía curl (documentado por el autor). No es necesariamente bloqueante para cerrar la fase — la Fase 3 es la primera con datos reales de deuda — pero debe quedar explícito como criterio pendiente, no tácitamente cumplido.

---

## Bajo

### 6. `accept-invite.post.ts:43-45` traga el error real de `auth.api.createUser` sin loguearlo

El `catch {}` vacío evita enumeración de usuarios en la respuesta al cliente (razonable), pero también descarta sin registrar cualquier causa real distinta a "email duplicado" (error de conexión a DB, validación inesperada, etc.), dificultando debugging en producción. Sugerido: `console.error` antes de lanzar el 400 genérico.

### 7. `invite.post.ts:52` devuelve siempre el `token` en texto plano, incluso cuando el email se envió con éxito

El endpoint está gateado por `requireRole(['admin'])`, así que no es un fallo de control de acceso. Pero devolver el token siempre (en vez de solo cuando `emailSent === false`, que es el caso documentado como fallback) amplía innecesariamente la superficie de exposición del token (network tab del navegador, cualquier middleware de logging/APM futuro). Sugerido: solo incluir `token` en la respuesta cuando `emailSent === false`.

### 8. Migración `0001_thick_aaron_stack.sql:63` añade `"email" text NOT NULL` sin `DEFAULT`

Solo funciona porque la tabla `users` estaba vacía antes de la Fase 2 (confirmado, aplicó sin error). Dejo la nota para que ninguna migración futura de esta familia se copie sin backfill si alguna vez hay filas preexistentes.

---

## Verificado y correcto (sin hallazgos)

- Los 4 endpoints en `server/api/members/*` aplican `requireRole(['admin'])` de forma consistente; no encontré ningún endpoint de esa carpeta sin el guard.
- `canSeeIndividualDebt` (`server/utils/rbac.ts:33-35`) está bien definido para uso en Fase 3+: `false` para guest, `true` para admin/owner con sesión válida. Es solo un booleano — la aplicación real de la restricción a nivel de datos queda (correctamente) delegada a las queries de Fase 3.
- `banUser` de Better Auth revoca todas las sesiones activas al banear (confirmado contra la documentación oficial), por lo que la ausencia de un chequeo explícito de `user.banned` en `requireRole` no es un hueco real.
- El unique constraint en `invitations.token` y en `users.email` está presente en la migración y protege contra el double-spend funcional de un token de invitación reutilizado concurrentemente (ver nota en hallazgo #2).
- La desviación de usar el catch-all de Better Auth para login/logout en vez de endpoints propios (ya conocida/aceptada) no introdujo por sí sola ningún problema adicional más allá del hallazgo Crítico #1, que es específico del plugin `admin`, no del catch-all de login/logout.

---

## Recomendaciones priorizadas

1. **Crítico:** cerrar el acceso directo a `/api/auth/admin/*` o mover auditoría + reglas de autobloqueo a `databaseHooks` de Better Auth.
2. **Alto:** blindar `bootstrap-admin.post.ts` contra la carrera de dos-admins-simultáneos (transacción/advisory lock/fila centinela).
3. **Medio:** unificar el tipo de usuario de sesión (eliminar los 5 casts duplicados); corregir `default.vue` para usar `useSession(useFetch)`; documentar el gap de test de integración como pendiente explícito.
4. **Bajo:** loguear el error real en `accept-invite`, limitar el `token` en la respuesta de `invite.post.ts` al caso `emailSent === false`.

## Preguntas sin resolver

- ¿El endpoint `/api/auth/bootstrap-admin` y en general `/api/auth/*` van a estar expuestos a internet público antes de que el operador haga el primer bootstrap, o el despliegue inicial ocurre en una red controlada? Esto determina si el hallazgo #2 es explotable en la práctica o solo teórico para este proyecto en concreto.
- ¿Se planea usar impersonación (`/admin/impersonate-user`) como feature de soporte en alguna fase futura? Si no, lo más simple es bloquear esa ruta específica en vez de construir hooks genéricos de auditoría para todo el plugin.
