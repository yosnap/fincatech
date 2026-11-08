import { purgeContribution } from '../../../../services/contribution-service'
import { requireRole } from '../../../../utils/rbac'

// Borrado definitivo de un aporte EN LA PAPELERA (solo Admin, RT8-4). El justificante de una
// transferencia cuelga de su movimiento, así que aquí no hay archivos que limpiar.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de aporte' })
  }

  return purgeContribution({ contributionId: id, actorId: actor.id })
})
