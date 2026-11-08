import { z } from 'zod'
import {
  createTransaction,
  getBankSummary,
  listTransactions,
  restoreTransaction,
  trashTransaction,
  updateTransaction
} from '../services/bank-service'
import { getPendingQuotas } from '../services/contribution-service'
import { confirmBackfill, createScheduleEntry, getMortgageOverview, previewBackfill } from '../services/mortgage-service'
import {
  amountCentsSchema,
  bankDirectionSchema,
  bankTransactionFieldsSchema,
  calendarDateSchema,
  externalCategorySchema
} from '../validation/finance'
import { euros, truncate } from './format'
import { defineTool } from './types'

// Herramientas de movimientos bancarios, resumen y cuotas pendientes (fase 4). Todas delegan en
// los servicios: mismas reglas y misma auditoría que la web.

const MAX_TRANSACTIONS = 60

export const bankTools = [
  defineTool({
    name: 'resumen_banco',
    description: 'Saldo actual y pre-compra de la cuenta, efectivo pendiente de depósito, ingresos sin aporte asociado y fondo común por miembro. Úsala antes de responder cualquier pregunta sobre cuánto dinero hay.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async (actor) => {
      const summary = await getBankSummary(actor)
      return {
        saldoActual: euros(summary.currentCents),
        saldoPreCompra: euros(summary.prePurchaseCents),
        efectivoPendienteDeDeposito: euros(summary.cashPendingCents),
        efectivoPendiente: summary.cashPending.map(item => ({
          aporteId: item.id,
          miembro: item.memberName,
          importe: euros(item.amountCents),
          fecha: item.date
        })),
        ingresosSinAporte: summary.unmatchedDeposits.map(item => ({
          movimientoId: item.id,
          fecha: item.date,
          importe: euros(item.amountCents),
          descripcion: item.description
        })),
        fondoComun: summary.fondoComun?.map(member => ({
          miembro: member.name,
          aportado: euros(member.contributedCents),
          parteSalidas: euros(member.withdrawalsShareCents),
          saldo: euros(member.balanceCents)
        })) ?? null
      }
    }
  }),

  defineTool({
    name: 'listar_movimientos',
    description: 'Lista los movimientos bancarios (ingresos y salidas) con su importe. Filtrable por rango de fechas y por dirección. Ordenados del más reciente al más antiguo; si hay más que el límite, se omiten los más antiguos. No incluye lo que está en la papelera.',
    kind: 'read',
    inputSchema: z.object({
      desde: calendarDateSchema.optional(),
      hasta: calendarDateSchema.optional(),
      direccion: bankDirectionSchema.optional(),
      limite: z.number().int().min(1).max(MAX_TRANSACTIONS).optional()
    }),
    handler: async (_actor, input) => {
      const all = await listTransactions()
      const filtered = all.filter(t =>
        (!input.direccion || t.direction === input.direccion)
        && (!input.desde || t.date >= input.desde)
        && (!input.hasta || t.date <= input.hasta)
      )
      const { items, omitted } = truncate(filtered.reverse(), input.limite ?? MAX_TRANSACTIONS)
      return {
        movimientos: items.map(t => ({
          id: t.id,
          fecha: t.date,
          direccion: t.direction,
          importe: euros(t.amountCents),
          descripcion: t.description,
          categoriaExterna: t.category,
          tieneJustificante: t.hasProof,
          cargoHipoteca: t.mortgagePeriod
        })),
        omitidos: omitted
      }
    }
  }),

  defineTool({
    name: 'crear_movimiento',
    description: 'Registra un movimiento manual en la cuenta (un ingreso o una salida). Para aportes de un miembro usa crear_aporte, no esta herramienta.',
    kind: 'write',
    inputSchema: bankTransactionFieldsSchema,
    handler: async (actor, input) => {
      const transaction = await createTransaction({
        actorId: actor.id,
        date: input.date,
        direction: input.direction,
        amountCents: input.amountCents,
        description: input.description,
        category: input.category
      })
      return { movimientoId: transaction.id, fecha: transaction.date, importe: euros(transaction.amountCents) }
    }
  }),

  defineTool({
    name: 'editar_movimiento',
    description: 'Corrige fecha, dirección, importe, descripción o categoría de un movimiento. Si era el cargo automático de la hipoteca queda como movimiento manual (se indica en la respuesta).',
    kind: 'write',
    inputSchema: bankTransactionFieldsSchema.extend({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const { transaction, mortgagePeriodCleared } = await updateTransaction({
        transactionId: input.id,
        actorId: actor.id,
        date: input.date,
        direction: input.direction,
        amountCents: input.amountCents,
        description: input.description,
        category: input.category
      })
      return {
        movimientoId: transaction.id,
        importe: euros(transaction.amountCents),
        convertidoAManual: mortgagePeriodCleared !== null,
        mesHipotecaQueEra: mortgagePeriodCleared
      }
    }
  }),

  defineTool({
    name: 'eliminar_movimiento',
    description: 'Mueve un movimiento a la papelera (no lo borra: se puede restaurar y conserva su justificante). Deja de contar en el saldo.',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const transaction = await trashTransaction({ transactionId: input.id, actorId: actor.id })
      return { movimientoId: transaction.id, enPapelera: true }
    }
  }),

  defineTool({
    name: 'restaurar_movimiento',
    description: 'Saca un movimiento de la papelera y vuelve a contarlo en el saldo.',
    kind: 'write',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const transaction = await restoreTransaction({ transactionId: input.id, actorId: actor.id })
      return { movimientoId: transaction.id, enPapelera: false }
    }
  }),

  defineTool({
    name: 'cuotas_pendientes',
    description: 'Cuotas mensuales que aún no ha pagado cada miembro (meses del grid sin aporte). No incluye meses futuros.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const { settings, pending } = await getPendingQuotas()
      return {
        importeCuota: settings.quotaAmountCents != null ? euros(settings.quotaAmountCents) : null,
        primerMesConCuota: settings.quotaStartMonth,
        pendientes: pending
      }
    }
  }),

  defineTool({
    name: 'ver_hipoteca',
    description: 'Tramos configurados de la hipoteca (importe y día de cargo desde qué mes), marca de agua del relleno y cargos automáticos existentes, incluidos los que están en la papelera.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const overview = await getMortgageOverview()
      return {
        tramos: overview.schedule.map(entry => ({
          id: entry.id,
          importe: euros(entry.amountCents),
          diaDeCargo: entry.chargeDay,
          desdeElMes: entry.effectiveFrom
        })),
        rellenadoHasta: overview.generatedThrough,
        cargos: overview.charges.map(charge => ({
          movimientoId: charge.id,
          mes: charge.month,
          fecha: charge.date,
          importe: euros(charge.amountCents),
          enPapelera: charge.deletedAt !== null
        }))
      }
    }
  }),

  defineTool({
    name: 'configurar_hipoteca',
    description: 'Añade un tramo de hipoteca: a partir de un mes, el cargo tiene ese importe y cae ese día. No reescribe cargos ya creados.',
    kind: 'destructive',
    inputSchema: z.object({
      amountCents: amountCentsSchema,
      chargeDay: z.number().int().min(1).max(31),
      effectiveFrom: z.string().describe('Mes de inicio en formato YYYY-MM (no anterior a 2026-09)')
    }),
    handler: async (actor, input) => {
      const entry = await createScheduleEntry({
        actorId: actor.id,
        amountCents: input.amountCents,
        chargeDay: input.chargeDay,
        effectiveFrom: input.effectiveFrom
      })
      return { tramoId: entry.id, importe: euros(entry.amountCents), desdeElMes: entry.effectiveFrom }
    }
  }),

  defineTool({
    name: 'listar_pagos_hipoteca_manuales',
    description: 'Pagos manuales que podrían ser el cargo de la hipoteca de un mes (coincide el importe o la descripción menciona la hipoteca) y los meses que aún no tienen cargo. Úsala antes de rellenar.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const preview = await previewBackfill()
      return {
        mesesACrear: preview.toCreate.map(charge => ({ mes: charge.month, fecha: charge.date, importe: euros(charge.amountCents) })),
        mesesEnPapelera: preview.toRestore,
        pagosManualesAdoptables: preview.candidates.map(candidate => ({
          movimientoId: candidate.id,
          mes: candidate.month,
          fecha: candidate.date,
          importe: euros(candidate.amountCents),
          descripcion: candidate.description,
          coincideElImporte: candidate.amountMatches
        }))
      }
    }
  }),

  defineTool({
    name: 'rellenar_hipoteca',
    description: 'Crea los cargos de hipoteca que falten hasta hoy y adopta como cargo del mes los pagos manuales indicados (no se borra nada). No modifica cargos existentes.',
    kind: 'destructive',
    inputSchema: z.object({
      adoptarMovimientoIds: z.array(z.string().uuid()).default([])
    }),
    handler: async (actor, input) => {
      const result = await confirmBackfill({ actorId: actor.id, adoptTransactionIds: input.adoptarMovimientoIds })
      return {
        mesesCreados: result.created.map(charge => charge.month),
        mesesAdoptados: result.adopted.map(row => row.month),
        mesesEnPapelera: result.toRestore,
        nota: 'Los meses en papelera no se recrean: hay que restaurarlos desde la web.'
      }
    }
  })
]

export { externalCategorySchema }
