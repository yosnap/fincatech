---
phase: 2
title: "Auth y RBAC 3 roles"
status: pending
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
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

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
- [ ] Schema users/sessions/invitations + enum de roles
- [ ] Login/logout con sesión httpOnly (Lucia + argon2)
- [ ] Middleware de sesión + `requireRole` server-side
- [ ] Flujo de invitación por email con token de un solo uso
- [ ] `canSeeIndividualDebt(guest)=false` aplicado en capa de datos
- [ ] Tabla `audit_log` + escritura en mutaciones de auth
- [ ] Baja de miembro como soft-delete

## Success Criteria
- [ ] Guest autenticado recibe 403/datos agregados al pedir desglose individual (verificado por test de integración).
- [ ] Solo Admin puede invitar/editar/dar de baja miembros.
- [ ] Token de invitación caduca y es de un solo uso.
- [ ] Cada acción sensible deja registro en `audit_log` con actor+timestamp.
- [ ] Contraseñas nunca en texto plano; sesión expira.

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
