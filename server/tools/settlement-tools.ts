import { z } from 'zod'
import { getExpenseStatistics } from '../services/dashboard-service'
import { getSettlement } from '../services/settlement-service'
import { euros } from './format'
import { defineTool } from './types'

// Herramientas de liquidación y estadísticas (fase 4): devuelven lo mismo que la web, calculado
// por los mismos servicios (incluida la parte de fondo común).

export const settlementTools = [
  defineTool({
    name: 'ver_liquidacion',
    description: 'Cuentas entre el usuario y cada contraparte: cuánto le deben, cuánto debe y la diferencia neta, con el detalle de cada cuota pendiente y el saldo del fondo común.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async (actor) => {
      const settlement = await getSettlement(actor)
      return {
        teDebenEnTotal: euros(settlement.totalTheyOweMeCents),
        debesEnTotal: euros(settlement.totalIOweThemCents),
        diferenciaNeta: euros(settlement.totalNetCents),
        contrapartes: settlement.counterparties.map(counterparty => ({
          persona: counterparty.name,
          personaId: counterparty.userId,
          teDebe: euros(counterparty.theyOweMeCents),
          leDebes: euros(counterparty.iOweThemCents),
          neto: euros(counterparty.netCents),
          totalGastadoPorElla: counterparty.totalSpentCents != null ? euros(counterparty.totalSpentCents) : null,
          cuotasQueTeDebe: counterparty.theyOweMeLines.map(line => ({
            debtId: line.debtId,
            gastoId: line.expenseId,
            descripcion: line.description,
            importe: euros(line.amountCents),
            fechaDelGasto: line.expenseDate,
            estado: line.status
          })),
          cuotasQueLeDebes: counterparty.iOweThemLines.map(line => ({
            debtId: line.debtId,
            gastoId: line.expenseId,
            descripcion: line.description,
            importe: euros(line.amountCents),
            fechaDelGasto: line.expenseDate,
            estado: line.status
          }))
        })),
        fondoComun: settlement.fondoComun?.map(member => ({
          miembro: member.name,
          aportado: euros(member.contributedCents),
          parteDeLasSalidas: euros(member.withdrawalsShareCents),
          saldo: euros(member.balanceCents)
        })) ?? null
      }
    }
  }),

  defineTool({
    name: 'estadisticas',
    description: 'Totales de gasto por mes (últimos 12), por tipo de gasto, saldo neto por propietario y total gastado por cada uno.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async (actor) => {
      const stats = await getExpenseStatistics(actor)
      return {
        porMes: stats.monthly.map(month => ({ mes: month.label, total: euros(month.totalCents) })),
        porTipo: stats.byType.map(type => ({ tipo: type.label, total: euros(type.totalCents), numeroDeGastos: type.count })),
        saldoPorPropietario: stats.byOwner?.map(owner => ({ persona: owner.name, saldo: euros(owner.netCents) })) ?? null,
        gastadoPorPersona: stats.byCreator?.map(creator => ({
          persona: creator.name,
          total: euros(creator.totalCents),
          numeroDeGastos: creator.count
        })) ?? null
      }
    }
  })
]
