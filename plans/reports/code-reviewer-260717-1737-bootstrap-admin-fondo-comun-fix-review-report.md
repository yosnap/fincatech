# Revisión: fix de bootstrap-admin vs. usuario de sistema `system-fondo-comun`

## Alcance
- Archivo revisado: `server/api/auth/bootstrap-admin.post.ts` (diff vs. `a85b52b`, working tree sin commitear)
- Archivos de contexto: `server/db/seed/fondo-comun.ts`, `server/plugins/seed-fondo-comun.ts`, `server/db/schema/users.ts`, `server/utils/rbac.ts`, `server/utils/auth.ts`, `server/middleware/auth.ts`, `server/api/members/[id]/role.patch.ts`, `server/api/members/[id]/deactivate.post.ts`
- LOC del diff: 8 líneas (2 imports + 1 línea de lógica + comentario)

## Veredicto general
El fix es correcto, mínimo y coherente con el patrón ya usado en el resto del código (`role.patch.ts`, `deactivate.post.ts`, `assessment-service.ts` ya excluían `FONDO_COMUN_USER_ID` de operaciones sobre "miembros reales"). No introduce vectores de bypass. Único hallazgo real: falta de test de regresión para un endpoint de auth que ya causó un incidente de producción.

## Hallazgos por pregunta

### 1. Race condition (lock + filtro)
**Verificado línea a línea, sin problema.** `pg_advisory_xact_lock` se adquiere en la línea 38, el `findFirst` filtrado en la línea 40 — orden sin cambios respecto al código anterior. Adicionalmente confirmé la propiedad que hace que la serialización siga siendo correcta aunque `auth.api.createUser` (línea 45-47) escriba por el pool global de `db` y no por `tx`: el lock es de ámbito de transacción (`xact`) y esa transacción no hace COMMIT hasta que el callback async completo —incluyendo el `await auth.api.createUser`— resuelve. Por tanto una segunda request bloqueada en el lock solo despierta después de que el INSERT del primer admin ya esté commiteado, y su propio `findFirst` (con lectura fresca) lo verá. No es un cambio de este diff, pero quedó confirmado que sigue siendo correcto.

### 2. ¿Hay otro usuario "de sistema" sin excluir?
**No.** `server/db/seed/` solo contiene `fondo-comun.ts`, y `server/plugins/` solo tiene un plugin (`seed-fondo-comun.ts`) que inserta en `users` antes de que exista un Admin. `server/db/schema/users.ts` no define ningún otro rol/flag "de sistema". Único punto de exclusión necesario: `FONDO_COMUN_USER_ID`.

### 3. ¿El bypass abre alguna vía de abuso?
**No, por tres capas independientes:**
- El endpoint `bootstrap-admin` no acepta `id` en el body (`bodySchema` solo admite `email/password/name`), así que un atacante no puede forzar que Better Auth le asigne `id = 'system-fondo-comun'` a su propia cuenta a través de este endpoint.
- Aunque alguien lograra tener sesión como `system-fondo-comun` (no puede: no tiene fila en `accounts`, por lo que `emailAndPassword` no tiene credencial que verificar), su `role: 'fondo'` no está en `ROLE_VALUES = ['admin','owner','guest']` (`server/utils/rbac.ts:4`). **Ningún** `requireRole(...)` del código (revisé las ~60 llamadas) acepta `'fondo'`, así que ese rol no pasa ningún check de autorización real.
- `role.patch.ts` y `deactivate.post.ts` bloquean explícitamente `targetId === FONDO_COMUN_USER_ID` para impedir que un admin (legítimo) intente convertirlo en miembro gestionable.

### 4. ¿Otro sitio con el mismo bug (`findFirst`/`count` sobre `users` para detectar "primer arranque")?
**No.** Grep exhaustivo de `users.findFirst`, `from(users)`, `query.users.` en todo `server/` — el único código que decide "¿es la primera vez que arranca la app?" es `bootstrap-admin.post.ts`. Los demás usos de `FONDO_COMUN_USER_ID` (`role.patch.ts`, `deactivate.post.ts`, `assessment-service.ts`, `members/index.get.ts`) ya excluían correctamente ese id — son preexistentes y no tienen esta clase de bug.

### 5. Mensaje de error en reintento con admin real ya existente
**Preciso, no engañoso.** El filtro solo excluye `FONDO_COMUN_USER_ID`; cualquier admin real creado sí dispara el `existing` y el 403 "Ya existe al menos un usuario; usa invitaciones" sigue siendo la descripción correcta del estado.

## Hallazgos adicionales (fuera de las 5 preguntas)

### Medio — Sin test de regresión para `bootstrap-admin.post.ts`
No existe ningún archivo de test para este endpoint (`find server -iname "*bootstrap*"` solo devuelve el propio handler). Este es exactamente el endpoint que causó el incidente de producción documentado en este mismo mensaje, y no quedó cubierto por los "21/21 tests" verdes que se mencionan como evidencia. Sin un test que reproduzca el escenario "solo existe `system-fondo-comun`" (fixture ya trivial: insertar esa fila antes del test), una regresión futura en este archivo o en el seed de `fondo-comun` volvería a pasar CI sin detección.
**Sugerencia:** añadir un test de integración con al menos 3 casos: (a) éxito cuando solo existe `system-fondo-comun`, (b) 403 cuando ya hay un admin real, (c) dos requests concurrentes crean un único admin.

### Informativo — Orden de escritura del audit log (no introducido por este diff)
`writeAuditLog` (línea 50-56) se ejecuta fuera de la transacción y sin `try/catch`; si falla, el admin ya quedó creado pero la request devuelve 500 y el cliente no recibe la cookie de sesión (obligaría a login manual). Comportamiento preexistente a este fix, no en el alcance de la corrección actual — lo señalo solo como contexto, no bloqueante.

## Conclusión
El fix corrige exactamente la causa raíz descrita (exclusión de `FONDO_COMUN_USER_ID` en el check de "primer usuario"), no debilita la ventana de cierre del bootstrap, no introduce condiciones de carrera nuevas y no abre ninguna vía de escalamiento de privilegios via el usuario de sistema. El único bloqueante real antes de dar por cerrado el incidente es la ausencia de cobertura de test para este endpoint crítico.

Status: DONE_WITH_CONCERNS
Summary: El fix es correcto y seguro (verificado línea a línea contra las 5 preguntas, sin bypass ni bug residual), pero `bootstrap-admin.post.ts` no tiene ningún test — el mismo endpoint que causó el incidente queda sin regresión automatizada que lo proteja a futuro.
