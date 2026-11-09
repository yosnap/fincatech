import { z } from 'zod'
import { restoreContribution } from '../../../../services/contribution-service'
import { requireRole } from '../../../../utils/rbac'

const bodySchema = z.object({
  // «Restaurar igualmente»: la web ya avisó de que existe un aporte idéntico (409
  // possible_duplicate) y el Admin decide mantener los dos.
  force: z.boolean().optional()
})

// Restaurar un aporte desde la papelera (solo Admin). Devuelve también los avisos del
// servicio (ingreso espejo eliminado, ingreso espejo aún en la papelera).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de aporte' })
  }

  const body = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Cuerpo inválido' })
  }

  const { contribution, warnings } = await restoreContribution({
    contributionId: id,
    actorId: actor.id,
    actorRole: actor.role,
    force: parsed.data.force
  })

  return { contribution, warnings }
})
