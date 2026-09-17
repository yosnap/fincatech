import { deleteContribution } from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'

// Borrado duro: el autor del registro o el Admin (regla del servicio, patrón expenses).
// El movimiento bancario vinculado NUNCA se borra con el aporte — solo queda desvinculado;
// si pierde su origen aparece en la alerta de "ingresos sin aporte asociado" del resumen.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de aporte' })
  }

  return deleteContribution({ contributionId: id, actorId: actor.id, actorRole: actor.role })
})
