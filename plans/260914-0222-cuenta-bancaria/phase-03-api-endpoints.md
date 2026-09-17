---
phase: 3
title: "Endpoints de API"
status: implemented
priority: P1
effort: "6h"
dependencies: [2]
---

# Phase 3: Endpoints de API

## Overview
Endpoints bajo `/api/bank/**` siguiendo el patrón existente (zod + `requireRole` + multipart para justificantes) y extensión additive de la liquidación con el saldo del fondo común.

## Requirements
- Functional: CRUD movimientos con justificante opcional y adjunto posterior; CRUD contribuciones; settings (admin); resumen de conciliación; liquidación extendida.
- Non-functional: misma validación de archivos que `expenses` (whitelist jpeg/png/pdf, 10MB, magic bytes); Invitado sin desglose individual.

## Architecture

```
server/api/bank/
  transactions/
    index.get.ts        // lista completa con balanceCentsAfter (paginación en cliente, patrón del repo)
    index.post.ts       // multipart: campos zod + proof opcional → MinIO → fila + payment_proofs
    [id].get.ts         // detalle con proof
    [id].delete.ts      // admin; desvincula aportes
    [id]/proof.get.ts   // signed URL del justificante
    [id]/proof.post.ts  // adjuntar justificante DESPUÉS (hasProof false → true)
  contributions/
    index.get.ts        // propias siempre; todas si admin/owner
    index.post.ts       // opción A (self) u opción B (admin por otro → registeredBy);
                        // cuota: acepta months (1-N, adelanto multi-mes);
                        // transfer: auto-crea ingreso bancario vinculado (proof → movimiento)
    [id].patch.ts       // editar / vincular-desvincular bankTransactionId (admin)
    [id].delete.ts      // autor o admin
  settings.get.ts       // lectura: autenticados
  settings.put.ts       // admin: purchaseDate, quotaAmountCents, quotaStartMonth
  summary.get.ts        // { currentCents, prePurchaseCents, cashPending[], unmatchedDeposits[], fondoComun[] }
```

Liquidación: extender `server/api/settlement/index.get.ts` + `settlement-service.ts` para añadir `fondoComun` (por miembro, solo admin/owner — el Invitado recibe `null`, igual que `totalSpentCents`).

RBAC:
- Movimientos/summary/settings(lectura): cualquier autenticado (info comunal).
- Crear/editar movimientos y settings(escritura): admin.
- Contribuciones: cada autenticado crea las suyas; admin crea/edita/borra cualquiera; `registeredBy` siempre = sesión actual.
- `summary.fondoComun` y grid por miembro: oculto a Invitado.

Zod (resumen):
- direction: `z.enum(['deposit','withdrawal'])`; category: `z.enum(['hacienda','ayuntamiento','impuestos','iva','otro']).optional()` solo si direction=deposit y sin aporte vinculado.
- amount: `z.number().int().positive()` (euros → céntimos en cliente o server, mismo criterio que expenses).
- period: `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)`.
- months (solo cuota): `z.number().int().min(1).max(24).optional()` — adelanto multi-mes.
- El file multipart de una contribución SOLO se acepta con `method='transfer'` y se adjunta al movimiento auto-creado (ticket bancario); el aporte en efectivo no lleva justificante (lo trae su depósito al vincularlo).

## Related Code Files
- Create: `server/api/bank/**` (árbol anterior)
- Modify: `server/api/settlement/index.get.ts`, `server/services/settlement-service.ts`
- Reutilizar: `server/services/storage.ts`, `server/utils/file-signature.ts`, `server/utils/rbac.ts`

## Implementation Steps
1. Endpoints de transactions (get/post/list/delete).
2. Proof get/post (adjuntar después) reutilizando la validación de `expenses/index.post.ts`.
3. Endpoints de contributions con reglas de registro self/admin.
4. settings get/put.
5. summary.get con `bank-core`.
6. Extender settlement con `fondoComun` (additive; Invitado → null).
7. Verificar cada endpoint con petición manual (curl o REST client) contra dev.

## Success Criteria
- [x] POST movimiento sin archivo crea la fila con `hasProof=false`; POST posterior en `[id]/proof` lo adjunta y voltea `hasProof`.
- [x] Un owner puede crear su contribución; un owner NO puede crear la de otro; el admin sí (registeredBy = admin).
- [x] `summary.get` devuelve saldos y descuadres correctos (validado contra fixtures del phase 2).
- [x] `settlement` incluye `fondoComun` para admin/owner y `null` para Invitado; las deudas pairwise no cambian.
- [x] Archivo de tipo no permitido o >10MB rechazado (magic bytes).

## Risk Assessment
- `payment_proofs` no tiene FK real: consistencia `hasProof` ↔ filas de proof se mantiene en el servicio (mismo riesgo aceptado del módulo expenses).
- Extender settlement rompería la página si el campo llega mal tipado → mantener additive y con test de contrato ligero (tipo en respuesta).
