import { and, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { ideaComments } from '../../../../db/schema'
import { writeAuditLog } from '../../../../utils/audit'
import { requireRole } from '../../../../utils/rbac'

// Moderación: solo Admin borra comentarios de otros (limpieza de pruebas, contenido
// inapropiado, etc.). Borrado real (no soft-delete): un comentario de prueba no necesita
// quedar en auditoría de la misma forma que ideas/propuestas/tareas.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const ideaId = getRouterParam(event, 'id')
  const commentId = getRouterParam(event, 'commentId')
  if (!ideaId || !commentId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea o de comentario' })
  }

  const comment = await db.query.ideaComments.findFirst({
    where: and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId))
  })
  if (!comment) {
    throw createError({ statusCode: 404, statusMessage: 'Comentario no encontrado' })
  }

  await db.delete(ideaComments).where(eq(ideaComments.id, commentId))

  await writeAuditLog({
    actorId: actor.id,
    action: 'idea_comment_deleted',
    entityType: 'idea',
    entityId: ideaId,
    metadata: { commentId, authorId: comment.authorId }
  })

  return { success: true }
})
