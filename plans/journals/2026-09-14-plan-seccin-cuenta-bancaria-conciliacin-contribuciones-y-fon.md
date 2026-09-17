---
title: "Plan: sección Cuenta bancaria (conciliación, contribuciones y fondo común)"
date: 2026-09-14
summary: "Brainstorm + plan 5 fases para movimientos bancarios pre/post compra, contribuciones con cuotas mensuales e ingresos externos, y saldo con el fondo común en liquidación"
---

# Plan: sección Cuenta bancaria (conciliación, contribuciones y fondo común)

## What happened
- El usuario pidió una nueva sección de finanzas: todos los recibos/depósitos/salidas del banco anteriores y posteriores a la compra del inmueble, contribuciones por miembro, y cuadre del saldo calculado con el banco (sin introducir saldo manual). Añadido a mitad de sesión: ingresos externos (devoluciones Hacienda/Ayuntamiento/IVA/impuestos).
- Scout del módulo finance existente: no hay nada de banco/contribuciones; `expenses`+`debts` no encaja semánticamente (participantSnapshot/debts obligatorios). Se reutilizan `payment_proofs` (polimórfica), `storage.ts` (MinIO) y RBAC.
- Brainstorm cerrado con 8 decisiones del usuario: dos períodos con corte en fecha de compra; saldo SIEMPRE calculado; aportes conciliados con depósitos (efectivo queda "pendiente de depósito"); registro de cuotas self (A) o admin por otro (B); cuota fija desde 2026-08; una sola cuenta; configuración global (no tabla property); contribuciones generan "saldo con el fondo común" (aportado − salidas/N, partes iguales) en liquidación, additive a las deudas pairwise.
- Plan creado en `plans/260914-0222-cuenta-bancaria` (5 fases: esquema BD, servicios+tests, API, UI movimientos, UI contribuciones+liquidación). `ak plan validate` OK.

## Decision
- Tablas propias (`bank_transactions`, `contributions`, `finance_settings`) en vez de forzar el dominio en `expenses`.
- Ingresos externos NO se acreditan a ningún miembro en el fondo común (solo engordan el bote): Σ saldos_miembros = fondo − ingresos externos.
- Tesorero = rol admin existente, sin cambios de RBAC.
- Invitado: ve movimientos/saldo (comunal) pero no desglose de contribuciones por miembro.

## Next steps
- Ejecutar el plan con `/ak:cook` (tras validación/red-team si se pide).
- Incidencias de tooling detectadas: `ak plan use` falla por normalización Unicode NFD/NFC en la ruta del worktree ("Unión"), y `set-active-plan.cjs` devuelve "Failed to update session state". El plan funciona como archivos; los punteros de plan activo no quedaron fijados.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
