import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideas, proposals } from '../../db/schema'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin, y solo desde la papelera (idea ya descartada). Las
// fotos asociadas se borran en cascada a nivel de FK (server/db/schema/media.ts). Todo en
// una transacción con lock de fila: si el delete fallara, el log de auditoría también se
// revierte (nunca queda un "eliminado permanentemente" de algo que sigue existiendo).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  await db.transaction(async (tx) => {
    const [idea] = await tx.select().from(ideas).where(eq(ideas.id, id)).for('update')
    if (!idea) {
      throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
    }
    if (idea.status !== 'discarded') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una idea descartada' })
    }

    // originIdeaId no tiene onDelete cascade a propósito (governance.ts) — si una idea fue
    // promovida y luego archivada, la propuesta que nació de ella sigue existiendo y aún
    // apunta aquí. Se bloquea con un mensaje claro en vez de dejar que Postgres devuelva un
    // error crudo de violación de FK.
    const linkedProposal = await tx.query.proposals.findFirst({ where: eq(proposals.originIdeaId, id) })
    if (linkedProposal) {
      throw createError({
        statusCode: 400,
        statusMessage: `No se puede eliminar: esta idea dio origen a la propuesta "${linkedProposal.title}", que todavía existe`
      })
    }

    await tx.delete(ideas).where(eq(ideas.id, id))

    await writeAuditLog({
      actorId: actor.id,
      action: 'idea_deleted_permanently',
      entityType: 'idea',
      entityId: id,
      metadata: { title: idea.title }
    }, tx)
  })

  return { success: true }
})
