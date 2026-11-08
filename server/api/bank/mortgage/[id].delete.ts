import { deleteScheduleEntry } from '../../../services/mortgage-service'
import { requireRole } from '../../../utils/rbac'

// Borrar un tramo no elimina los cargos que ya generó.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tramo' })
  }

  return deleteScheduleEntry({ entryId: id, actorId: actor.id })
})
