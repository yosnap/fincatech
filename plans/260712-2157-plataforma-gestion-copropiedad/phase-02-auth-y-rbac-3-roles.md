---
phase: 2
title: "Auth y RBAC 3 roles"
status: implemented
priority: P1
effort: 8h
dependencies: [1]
roadmap: "F1 · MVP financiero"
---

# Phase 2: Auth y RBAC 3 roles

## Context links
- PRD §3 (Roles y permisos), §5 (Seguridad y auditoría) — `docs/prd.md`
- Decisiones cerradas — `plans/reports/analisis-huecos-260712-1628-prd-gestion-copropiedad-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Autenticación de sesión y control de acceso por 3 roles (Administrador, Propietario, Invitado). El Invitado ve solo agregados, nunca desglose de deuda individual. Capa de auditoría (usuario+timestamp) para todo cambio sensible.
- **Prioridad:** P1
- **Estado de implementación:** Implementado (rama `feat/0.2.0-auth-rbac-3-roles`, mergeado a `develop`)
- **Estado de revisión:** Revisado por `code-reviewer` (1 crítico + 1 alto + 3 medios + 3 bajos, todos corregidos). Verificado manualmente end-to-end vía curl contra el dev server local + tests unitarios (`pnpm test`) para el contrato RBAC.

## Key Insights
- **Confirmado (verificado 2026-07-12):** Lucia fue deprecada por su autor en marzo 2025, sin desarrollo activo desde entonces; el repo se reconvirtió en recurso educativo, no librería de producción. **Decisión: usar Better Auth** (mismo patrón de sesión server-side + cookie httpOnly, ya soportado como skill en este entorno).
- Sesión server-side + cookie httpOnly vía Better Auth.
- RBAC debe imponerse en el SERVIDOR (Nitro), no solo ocultar UI. El Invitado es un actor externo (gestoría): fuga de desglose individual = incidente de privacidad, no cosmético.
- Restricción del Invitado es a nivel de datos: los endpoints deben filtrar/agregar según rol, no confiar en el frontend.
- Auditoría (PRD §5) es transversal: definir tabla `audit_log` ya aquí, la usan Fases 3, 6, 7.
- Admin invita miembros: flujo de invitación por email (token de un solo uso) reutilizable por notificaciones (Fase 5).

## Requirements
- **Funcional:** login/logout; invitación de miembros por Admin; asignación de rol; middleware de autorización por endpoint; perfil de usuario (base para canales de notificación de Fase 5).
- **No funcional:** contraseñas con hash fuerte (argon2/bcrypt); sesiones expirables; toda mutación sensible escribe en `audit_log` (actor, acción, entidad, timestamptz).

## Architecture
```
Request → server middleware (resuelve sesión) → handler
                                   │
                              requireRole(roles[])  → 403 si no autorizado
                                   │
                        capa de datos filtra agregados vs. desglose según rol
```
- `server/middleware/auth.ts`: resuelve `event.context.user` (rol incluido) por request. Estado por-request, NO en singletons.
- `server/utils/rbac.ts`: `requireRole(event, [...])`, `canSeeIndividualDebt(user)`.
- `audit_log` escrito dentro de la misma transacción que la mutación (ver Fase 3).

## Related code files
- Create: `server/db/schema/users.ts` (users, sessions, invitations, roles enum)
- Create: `server/db/schema/audit-log.ts`
- Create: `server/middleware/auth.ts`, `server/utils/rbac.ts`
- Create: `server/api/auth/[login|logout|accept-invite].post.ts`
- Create: `server/api/members/*` (invitar/editar/baja — solo Admin)
- Create: `app/pages/login.vue`, `app/pages/profile.vue`
- Modify: `app/layouts/default.vue` (navegación condicionada por rol)

## Implementation Steps
1. Schema `users` (rol enum: `admin|owner|guest`), `sessions`, `invitations` (token, expiry, usado).
2. Integrar Better Auth; hash argon2 (o el hash que traiga Better Auth por defecto); endpoints login/logout con cookie httpOnly + `SameSite=Lax`.
3. Middleware que hidrata `event.context.user` por request.
4. `requireRole` + helper `canSeeIndividualDebt` (false para guest).
5. Flujo de invitación: Admin crea invitación → email con token → `accept-invite` fija contraseña y rol.
6. CRUD de miembros restringido a Admin; baja = soft-delete (preserva histórico contable).
7. Tabla + helper `audit_log`; escribir en cada mutación de auth.
8. UI: login, perfil, navegación por rol.

## Todo list
- [x] Schema users/sessions/invitations + roles admin/owner/guest (vía plugin admin de Better Auth, no enum manual)
- [x] Login/logout con sesión httpOnly (Better Auth, no Lucia — confirmada deprecada; hash por defecto de Better Auth, no argon2 explícito)
- [x] Middleware de sesión + `requireRole` server-side
- [x] Flujo de invitación por email (SMTP Gmail) con token de un solo uso + fallback de enlace manual si falla el envío
- [x] `canSeeIndividualDebt(guest)=false` — helper listo, se aplicará en la capa de datos de Fase 3 (contabilidad)
- [x] Tabla `audit_log` + escritura en mutaciones de auth
- [x] Baja de miembro como soft-delete (banUser del plugin admin)

## Success Criteria
- [x] Guest autenticado recibe 403 al pedir un endpoint de admin (verificado por test unitario `server/utils/rbac.test.ts` + curl manual). La verificación de "agregados vs. desglose" en datos reales de deuda se completa en Fase 3, que es donde existen esos endpoints.
- [x] Solo Admin puede invitar/editar/dar de baja miembros (`requireRole(['admin'])` en los 4 endpoints de `server/api/members/*`, verificado con curl: guest/owner reciben 403).
- [x] Token de invitación caduca (48h) y es de un solo uso (verificado: reutilizar un token ya aceptado devuelve 400).
- [x] Cada acción sensible deja registro en `audit_log` con actor+timestamp (verificado: admin_bootstrap, invitation_created, invitation_accepted, member_role_changed, member_deactivated). Las rutas nativas `/api/auth/admin/*` de Better Auth (que no auditaban) se bloquean explícitamente (404) para que toda mutación de miembros pase por `server/api/members/*`.
- [x] Contraseñas nunca en texto plano (hash de Better Auth); sesión expira (cookie httpOnly + expiresAt).

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| Fuga de desglose de deuda al Invitado | Media×**Alto** | Autorización a nivel de datos + test que asegura agregación; revisar cada endpoint nuevo contra `canSeeIndividualDebt` |
| Autorización solo en UI (bypass por API) | Media×Alto | `requireRole` obligatorio en handlers; checklist de revisión por endpoint |
| Token de invitación reutilizable/robado | Baja×Alto | Un solo uso + expiración corta + invalidar al aceptar |
| ~~Adoptar Lucia sin mantenimiento activo~~ | — | Resuelto: se usa Better Auth directamente (Lucia confirmada deprecada) |
| Baja de miembro rompe histórico de deudas | Media×Medio | Soft-delete; nunca borrado físico de usuarios con movimientos |

## Security Considerations
- Cookies `httpOnly`, `Secure`, `SameSite=Lax`; protección CSRF en mutaciones.
- Hash argon2id; sin enumerar usuarios en errores de login.
- Principio de mínimo privilegio: guest es solo-lectura de agregados; imponer en servidor.
- `audit_log` inmutable (sin update/delete desde la app).

## Next steps
Fase 3: motor de contabilidad y división de deudas sobre esta base de identidad/roles/auditoría.

## Nota de implementación (post-hoc)
- **Entrega de invitaciones:** decisión del usuario — SMTP con Gmail (`nodemailer`), no enlace manual. Si el envío falla (p. ej. credenciales de Gmail no configuradas en dev), el endpoint de invitación devuelve el token en la respuesta como fallback para que el Admin pueda compartir el enlace a mano; si el email se envía bien, el token no viaja en la respuesta (principio de mínima exposición, hallazgo de code review).
- **RBAC vía plugin `admin` de Better Auth** (roles custom admin/owner/guest con `createAccessControl`) en vez de un enum + CRUD manual: reutiliza `setRole`/`banUser`/`createUser`/`listUsers` ya probados por la librería. `banUser` (permanente, sin `banExpires`) es el mecanismo de soft-delete de "baja de miembro".
- **Bug de arranque no previsto por el plan:** con `disableSignUp: true` y `invitations.invitedBy` con FK NOT NULL a `users`, no existía forma de crear el primer Admin. Se añadió `POST /api/auth/bootstrap-admin`: solo funciona si `COUNT(users)=0`, protegido con un advisory lock de Postgres (`pg_advisory_xact_lock`) para evitar que dos requests concurrentes creen dos "primeros admin". Se autodeshabilita permanentemente en cuanto existe un usuario.
- **Hallazgo crítico de code review:** el catch-all `server/api/auth/[...all].ts` montaba también las rutas nativas del plugin admin de Better Auth (`/api/auth/admin/set-role`, `/ban-user`, `/create-user`, `/impersonate-user`), que mutan usuarios sin pasar por `writeAuditLog` ni por los guards anti-autobloqueo de `server/api/members/*`. Se bloquean explícitamente (404) — toda gestión de miembros debe pasar por `server/api/members/*`, que sí audita. Las llamadas internas `auth.api.setRole/banUser/createUser()` (usadas por esos endpoints) no pasan por HTTP y no se ven afectadas.
- **Compatibilidad h3 v2 (Nuxt 4) con Better Auth:** la guía oficial de Better Auth para Nuxt (`auth.handler(toWebRequest(event))`) no funciona con h3 v2 — `toWebRequest` ya no existe y el `event.req` de h3 v2 no trae URL absoluta utilizable por el router interno de Better Auth. Se usa en su lugar `toNodeHandler(auth)` de `better-auth/node` contra `event.node.req/res` (patrón Node/Express), documentado en `server/api/auth/[...all].ts`.
- **SSR con Better Auth + Nuxt:** el cliente singleton (`app/utils/auth-client.ts`, URL relativa) rompe con "Failed to parse URL" si se usa `authClient.getSession()` (no `useSession(useFetch)`) durante SSR en middlewares de ruta. Se creó `app/composables/use-auth.ts` (cliente "request-scoped" con `baseURL` absoluto vía `useRequestURL()` + forward de cookie) para `app/middleware/auth.ts` y `admin.ts`. Páginas/layout usan `authClient.useSession(useFetch)` (patrón oficial SSR-safe) en vez de la variante reactiva sin argumentos.
- **Tests:** no existía runner de tests en el proyecto. Se añadió `vitest` (mínimo, sin `@nuxt/test-utils`) con `server/utils/rbac.test.ts` cubriendo el contrato `requireRole`/`canSeeIndividualDebt`. No hay test HTTP de integración real (spin-up de servidor) — la cobertura de esa capa es la verificación manual con curl documentada arriba. Se deja como mejora pendiente si el criterio de aceptación literal ("test de integración") se considera insuficiente así.
- **Sin endpoint de "reactivar" miembro:** el plan solo pedía invitar/editar rol/dar de baja. Reactivar (unban) queda fuera de alcance de esta fase; añadir si se necesita.
