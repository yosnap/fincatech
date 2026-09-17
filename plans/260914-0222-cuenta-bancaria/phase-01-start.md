---
phase: 1
title: "Esquema de BD y migración"
status: implemented
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Esquema de BD y migración

## Overview
Crear las tablas `bank_transactions`, `contributions` y `finance_settings` en Drizzle, ampliar el uso de `payment_proofs` a movimientos bancarios y generar/aplicar la migración con backup previo.

## Requirements
- Functional: tablas nuevas con convenciones del repo (céntimos enteros, tipos `text` validados en capa de aplicación, FKs a `users`).
- Non-functional: migración solo-additiva (sin tocar tablas existentes salvo ninguna); aplicable con `pnpm db:migrate`.

## Architecture

```ts
// server/db/schema/bank.ts (nuevo)
bank_transactions:
  id uuid PK defaultRandom
  date date notNull            // fecha valor del movimiento
  direction text notNull       // 'deposit' | 'withdrawal' (validado en app)
  amountCents integer notNull  // siempre positivo
  description text notNull
  category text                // solo depósitos externos: 'hacienda'|'ayuntamiento'|'impuestos'|'iva'|'otro'
  hasProof boolean notNull default false
  registeredBy text notNull references users.id
  createdAt timestamp defaultNow

contributions:
  id uuid PK defaultRandom
  memberId text notNull references users.id
  amountCents integer notNull
  type text notNull            // 'pre_purchase' | 'quota' | 'extraordinary'
  period text                  // 'YYYY-MM'; null para pre_purchase y extraordinary
  method text notNull          // 'cash' | 'transfer'
  date date notNull            // fecha del aporte (no del depósito)
  bankTransactionId uuid       // FK lógica a bank_transactions (sin constraint dura, patrón polimórfico del repo)
  registeredBy text notNull references users.id  // quién lo registró (opción A: uno mismo; opción B: admin)
  notes text
  createdAt/updatedAt timestamp
  // Índice único PARCIAL: una sola cuota por miembro y mes (validación sesión 1).
  // El adelanto multi-mes crea N filas, una por mes; extraordinary/pre_purchase (period null) no colisionan
  // porque PostgreSQL trata los NULL como distintos en índices únicos.
  uniqueIndex('contributions_quota_unique').on(memberId, period).where(type = 'quota')

finance_settings:              // fila única id = 'global'
  id text PK
  purchaseDate date            // fecha de compra del inmueble (corte de períodos)
  quotaAmountCents integer     // cuota mensual fija
  quotaStartMonth text         // '2026-08'
  updatedAt timestamp
```

`payment_proofs` no cambia de esquema: su `entityType` es texto validado en aplicación → añadir `'bank_transaction'` a la whitelist de valores. ObjectName MinIO: `bank/transactions/{uuid}.{ext}`.

## Related Code Files
- Create: `server/db/schema/bank.ts`
- Modify: `server/db/schema/index.ts` (export barrel)
- Create: `drizzle/migrations/0015_cuenta_bancaria.sql` (vía `pnpm db:generate`)

## Implementation Steps
1. Backup de la BD antes de cualquier cambio de esquema (regla del proyecto).
2. Crear `server/db/schema/bank.ts` con las tres tablas según la arquitectura anterior.
3. Exportar en el barrel `server/db/schema/index.ts`.
4. `pnpm db:generate` → revisar el SQL generado (solo CREATE TABLE + índices).
5. Índices: `bank_transactions(date)`, `contributions(memberId)`, `contributions(period)`, y el índice único parcial de cuotas (ver arquitectura).
6. `pnpm db:migrate` y verificar con una consulta que las tablas existen.

## Success Criteria
- [x] Las tres tablas existen en BD con las columnas e índices especificados.
- [x] La migración es solo-additiva (no modifica tablas existentes).
- [x] `pnpm db:generate` + `pnpm db:migrate` ejecutados sin errores sobre backup previo.
- [x] Backup de la BD guardado antes de migrar.

## Risk Assessment
- Convención de tipos `text` + validación en app (no pg enums) confirmada por el scout en el esquema existente; si `db:generate` introduce algo inesperado (p. ej. default de fecha con zona), ajustar el esquema antes de migrar.
- Sin down migrations automáticas (regla del proyecto): el rollback es restaurar el backup.
