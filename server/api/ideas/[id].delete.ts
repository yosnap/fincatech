import { deleteIdeaPermanently } from '../../services/idea-service'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin, y solo desde la papelera (idea ya descartada).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  return deleteIdeaPermanently({ actor, ideaId: id })
})
