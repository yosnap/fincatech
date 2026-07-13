import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { ideas } from '../../../db/schema'
import { writeAuditLog } from '../../../utils/audit'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({ status: z.enum(['discussion', 'discarded']) })

// Solo Admin o el autor cambian el estado. 'discarded' es siempre final. 'promoted' solo
// admite pasar a 'discarded' (archivar la idea original una vez ya nació su propuesta;
// no se puede volver a 'discussion' ni promover dos veces) — el promote copia título y
// descripción a la propuesta en el momento de crearla, así que archivar la idea después
// no le quita nada a la propuesta ya existente.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, id) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }
  if (idea.status === 'discarded') {
    throw createError({ statusCode: 400, statusMessage: 'Esta idea ya está descartada' })
  }
  if (actor.role !== 'admin' && idea.authorId !== actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el autor pueden cambiar el estado' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  if (idea.status === 'promoted' && parsed.data.status !== 'discarded') {
    throw createError({ statusCode: 400, statusMessage: 'Una idea ya promovida solo puede archivarse (descartarse)' })
  }

  const [updated] = await db.update(ideas)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(ideas.id, id))
    .returning()

  await writeAuditLog({
    actorId: actor.id,
    action: 'idea_status_changed',
    entityType: 'idea',
    entityId: id,
    metadata: { status: parsed.data.status }
  })

  return { idea: updated }
})
