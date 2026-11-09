import { adminSettleDebt } from '../../../services/expense-service'
import { requireRole } from '../../../utils/rbac'

// Liquidar la deuda de otra persona (solo Admin, RT-14): «en nombre de», auditado con el
// deudor original en la metadata. La web ofrece el mismo botón — la web nunca queda detrás.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de cuota' })
  }

  return { debt: await adminSettleDebt({ debtId: id, actorId: actor.id, actorRole: actor.role }) }
})
