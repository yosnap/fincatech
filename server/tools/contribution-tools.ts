import { z } from 'zod'
import {
  createContribution,
  listContributions,
  listPossibleDuplicates,
  restoreContribution,
  trashContribution,
  updateContribution,
  linkContribution,
  unlinkContribution
} from '../services/contribution-service'
import { getUserNameMap } from '../utils/user-names'
import { calendarDateSchema, createContributionSchema, updateContributionSchema } from '../validation/finance'
import { euros, truncate } from './format'
import { defineTool } from './types'

// Herramientas de aportes (fase 4). `crear_aporte` NO acepta `force` (RT-6): si hay un posible
// duplicado se devuelve el 409 con el aporte existente y decide el usuario.

const MAX_CONTRIBUTIONS = 60

export const contributionTools = [
  defineTool({
    name: 'listar_aportes',
    description: 'Lista los aportes de los miembros (cuotas, pre-compra y extraordinarios) con importe, tipo, período y estado de depósito. Filtrable por miembro, tipo y rango de fechas. No incluye lo que está en la papelera.',
    kind: 'read',
    inputSchema: z.object({
      memberId: z.string().optional(),
      type: z.enum(['pre_purchase', 'quota', 'extraordinary']).optional(),
      desde: calendarDateSchema.optional(),
      hasta: calendarDateSchema.optional(),
      limite: z.number().int().min(1).max(MAX_CONTRIBUTIONS).optional()
    }),
    handler: async (_actor, input) => {
      const rows = await listContributions({
        memberId: input.memberId,
        type: input.type,
        from: input.desde,
        to: input.hasta
      })
      const names = await getUserNameMap([...new Set(rows.flatMap(row => [row.memberId, row.registeredBy]))])
      const { items, omitted } = truncate(rows, input.limite ?? MAX_CONTRIBUTIONS)
      return {
        aportes: items.map(row => ({
          id: row.id,
          miembro: names.get(row.memberId) ?? row.memberId,
          miembroId: row.memberId,
          importe: euros(row.amountCents),
          tipo: row.type,
          periodo: row.period,
          metodo: row.method,
          fecha: row.date,
          registradoPor: names.get(row.registeredBy) ?? row.registeredBy,
          movimientoVinculadoId: row.bankTransactionId,
          notas: row.notes
        })),
        omitidos: omitted
      }
    }
  }),

  defineTool({
    name: 'crear_aporte',
    description: 'Registra un aporte de un miembro. Una transferencia crea además el ingreso bancario vinculado; el efectivo queda pendiente de depósito. Si ya existe un aporte idéntico devuelve un conflicto (possible_duplicate) y NO se crea: pregunta al usuario antes de reintentar.',
    kind: 'write',
    inputSchema: createContributionSchema,
    handler: async (actor, input) => {
      const result = await createContribution({
        actorId: actor.id,
        actorRole: actor.role,
        memberId: input.memberId,
        amountCents: input.amountCents,
        type: input.type,
        period: input.period ?? null,
        method: input.method,
        date: input.date,
        months: input.months,
        notes: input.notes ?? null,
        // Sin `force`: el aviso de duplicado se devuelve al modelo, no se salta.
        force: false
      })
      return {
        aporteIds: result.contributions.map(row => row.id),
        meses: result.contributions.map(row => row.period).filter(Boolean),
        importe: euros(input.amountCents),
        movimientoVinculadoId: result.bankTransactionId
      }
    }
  }),

  defineTool({
    name: 'editar_aporte',
    description: 'Edita notas, fecha, importe, tipo o período de un aporte. Si es una transferencia individual con su ingreso, ese movimiento se sincroniza para que el saldo cuadre; si el movimiento es compartido o se vinculó a mano, cambiar el importe exige desvincular antes.',
    kind: 'write',
    inputSchema: updateContributionSchema.extend({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const { id, ...changes } = input
      const updated = await updateContribution({ contributionId: id, actorId: actor.id, ...changes })
      return {
        aporteId: updated.id,
        fecha: updated.date,
        importe: euros(updated.amountCents),
        tipo: updated.type,
        periodo: updated.period
      }
    }
  }),

  defineTool({
    name: 'eliminar_aporte',
    description: 'Mueve un aporte a la papelera (se puede restaurar). Si es una transferencia con su ingreso, el ingreso se mueve también, para que el saldo no cuente dinero sin aporte.',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const contribution = await trashContribution({
        contributionId: input.id,
        actorId: actor.id,
        actorRole: actor.role
      })
      return { aporteId: contribution.id, enPapelera: true }
    }
  }),

  defineTool({
    name: 'restaurar_aporte',
    description: 'Saca un aporte de la papelera. Puede fallar con conflicto si el miembro ya tiene una cuota viva de ese mes o si el miembro está de baja.',
    kind: 'write',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const result = await restoreContribution({
        contributionId: input.id,
        actorId: actor.id,
        actorRole: actor.role
      })
      return { aporteId: result.contribution.id, avisos: result.warnings }
    }
  }),

  defineTool({
    name: 'vincular_aporte',
    description: 'Vincula un aporte en efectivo (pendiente de depósito) al ingreso bancario real que lo refleja. El depósito no puede ser anterior al aporte ni estar categorizado como externo.',
    kind: 'write',
    inputSchema: z.object({
      aporteId: z.string().uuid(),
      movimientoId: z.string().uuid()
    }),
    handler: async (actor, input) => {
      const updated = await linkContribution({
        contributionId: input.aporteId,
        actorId: actor.id,
        bankTransactionId: input.movimientoId
      })
      return { aporteId: updated.id, movimientoVinculadoId: updated.bankTransactionId }
    }
  }),

  defineTool({
    name: 'desvincular_aporte',
    description: 'Desvincula un aporte de su ingreso bancario: vuelve a quedar pendiente de depósito. El movimiento no se toca.',
    kind: 'write',
    inputSchema: z.object({ aporteId: z.string().uuid() }),
    handler: async (actor, input) => {
      const updated = await unlinkContribution({ contributionId: input.aporteId, actorId: actor.id })
      return { aporteId: updated.id, movimientoVinculadoId: null }
    }
  }),

  defineTool({
    name: 'listar_duplicados_aportes',
    description: 'Grupos de aportes idénticos ya registrados (mismo miembro, importe, tipo, fecha y período). Sirve para explicar duplicados; para limpiarlos usa eliminar_aporte con el id sobrante.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const groups = await listPossibleDuplicates()
      return {
        grupos: groups.map(group => ({
          aportes: group.map(item => ({
            id: item.id,
            miembro: item.memberName,
            importe: euros(item.amountCents),
            tipo: item.type,
            periodo: item.period,
            fecha: item.date,
            registradoPor: item.registeredByName,
            registradoEl: item.createdAt
          }))
        }))
      }
    }
  })
]
