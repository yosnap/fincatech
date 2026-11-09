import { z } from 'zod'
import {
  adminSettleDebt,
  confirmDebtReceipt,
  getDebtRow,
  getExpenseDetail,
  listExpensesWithDebts,
  markDebtPaid,
  restoreExpense,
  trashExpense,
  updateExpenseDate,
  updateExpenseParticipants
} from '../services/expense-service'
import { getUserNameMap } from '../utils/user-names'
import { calendarDateSchema } from '../validation/finance'
import { assertEligibleParticipants } from '../validation/participants'
import { euros } from './format'
import { defineTool } from './types'

// Herramientas de gastos y deudas (fase 4). Todo pasa por los servicios: los mismos guards
// (papelera, cuotas ya pagadas, participantes activos) que la web.

const DEBT_STATUS_LABELS: Record<string, string> = {
  pending: 'pendiente',
  pending_confirmation: 'pendiente de confirmación',
  confirmed: 'confirmada'
}

export const expenseTools = [
  defineTool({
    name: 'listar_gastos',
    description: 'Lista los gastos vivos con su importe, fecha del gasto, estado y deudas asociadas. Los gastos en la papelera no aparecen.',
    kind: 'read',
    inputSchema: z.object({ limite: z.number().int().min(1).max(100).optional() }),
    handler: async (_actor, input) => {
      const expenses = await listExpensesWithDebts(input.limite ?? 50)
      const names = await getUserNameMap(expenses.flatMap(e => [e.createdBy, ...e.debts.map(d => d.debtorId)]))
      return {
        gastos: expenses.map(expense => ({
          id: expense.id,
          descripcion: expense.description,
          importe: euros(expense.amountCents),
          fechaDelGasto: expense.expenseDate,
          tipo: expense.type,
          estado: expense.status,
          pagador: names.get(expense.createdBy) ?? expense.createdBy,
          participantes: expense.participantCount,
          cuotas: expense.debts.map(debt => ({
            id: debt.id,
            deudor: names.get(debt.debtorId) ?? debt.debtorId,
            acreedor: names.get(debt.creditorId) ?? debt.creditorId,
            importe: euros(debt.amountCents),
            estado: DEBT_STATUS_LABELS[debt.status] ?? debt.status
          }))
        }))
      }
    }
  }),

  defineTool({
    name: 'ver_gasto',
    description: 'Detalle de un gasto con sus cuotas y el estado de cada una.',
    kind: 'read',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (_actor, input) => {
      const { expense, debts } = await getExpenseDetail(input.id)
      const names = await getUserNameMap([expense.createdBy, ...debts.map(debt => debt.debtorId)])
      return {
        id: expense.id,
        descripcion: expense.description,
        importe: euros(expense.amountCents),
        fechaDelGasto: expense.expenseDate,
        fechaDeAlta: expense.createdAt,
        tipo: expense.type,
        estado: expense.status,
        pagador: names.get(expense.createdBy) ?? expense.createdBy,
        enPapelera: expense.deletedAt !== null,
        cuotas: debts.map(debt => ({
          id: debt.id,
          deudor: names.get(debt.debtorId) ?? debt.debtorId,
          deudorId: debt.debtorId,
          importe: euros(debt.amountCents),
          estado: DEBT_STATUS_LABELS[debt.status] ?? debt.status
        }))
      }
    }
  }),

  defineTool({
    name: 'cambiar_fecha_gasto',
    description: 'Cambia la fecha del gasto (cuándo se pagó). No toca importes, deudas ni participantes. No admite fechas futuras.',
    kind: 'write',
    inputSchema: z.object({ id: z.string().uuid(), fecha: calendarDateSchema }),
    handler: async (actor, input) => {
      const updated = await updateExpenseDate({
        expenseId: input.id,
        actorId: actor.id,
        expenseDate: input.fecha
      })
      return { gastoId: updated.id, fechaDelGasto: updated.expenseDate }
    }
  }),

  defineTool({
    name: 'cambiar_participantes_gasto',
    description: 'Cambia entre quiénes se reparte un gasto (todo o nada: hay que enviar la lista completa de participantes). Solo si ninguna cuota tiene pagos registrados.',
    kind: 'write',
    inputSchema: z.object({
      id: z.string().uuid(),
      participantIds: z.array(z.string()).min(1)
    }),
    handler: async (actor, input) => {
      // Misma validación que el endpoint: solo miembros activos (admin/owner).
      await assertEligibleParticipants(input.participantIds)
      const updated = await updateExpenseParticipants({
        expenseId: input.id,
        actorId: actor.id,
        participantIds: input.participantIds
      })
      return { gastoId: updated.id, participantes: input.participantIds.length }
    }
  }),

  defineTool({
    name: 'eliminar_gasto',
    description: 'Mueve un gasto a la papelera. Se rechaza si alguna cuota ya está pagada o confirmada (el dinero ya cambió de manos).',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const expense = await trashExpense({ expenseId: input.id, actorId: actor.id, actorRole: actor.role })
      return { gastoId: expense.id, enPapelera: true }
    }
  }),

  defineTool({
    name: 'restaurar_gasto',
    description: 'Saca un gasto de la papelera. Se rechaza si algún participante está de baja.',
    kind: 'write',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const expense = await restoreExpense({ expenseId: input.id, actorId: actor.id })
      return { gastoId: expense.id, enPapelera: false }
    }
  }),

  defineTool({
    name: 'marcar_deuda_pagada',
    description: 'Marca una cuota como pagada. Si la cuota es de otra persona, el Admin la liquida en su nombre (queda auditado «en nombre de» y la cuota pasa a confirmada).',
    kind: 'write',
    inputSchema: z.object({ debtId: z.string().uuid() }),
    handler: async (actor, input) => {
      const debt = await getDebtRow(input.debtId)
      if (debt.debtorId === actor.id) {
        const updated = await markDebtPaid({ debtId: input.debtId, actorId: actor.id })
        return {
          debtId: updated.id,
          estado: DEBT_STATUS_LABELS[updated.status] ?? updated.status,
          aviso: 'Queda pendiente de que el acreedor (o un Admin) confirme la recepción.'
        }
      }
      const settled = await adminSettleDebt({ debtId: input.debtId, actorId: actor.id, actorRole: actor.role })
      return {
        debtId: settled.id,
        estado: DEBT_STATUS_LABELS[settled.status] ?? settled.status,
        liquidadaEnNombreDe: debt.debtorId
      }
    }
  }),

  defineTool({
    name: 'confirmar_cobro_deuda',
    description: 'Confirma que se recibió el pago de una cuota (la marca como cobrada). Solo el acreedor o el Admin.',
    kind: 'write',
    inputSchema: z.object({ debtId: z.string().uuid() }),
    handler: async (actor, input) => {
      const updated = await confirmDebtReceipt({
        debtId: input.debtId,
        actorId: actor.id,
        actorRole: actor.role
      })
      return { debtId: updated.id, estado: DEBT_STATUS_LABELS[updated.status] ?? updated.status }
    }
  })
]
