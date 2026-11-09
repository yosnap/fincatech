import { desc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { ideaComments, ideas, media, proposals } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { resolveMediaUrls } from '../utils/media-urls'
import type { SessionUser } from '../utils/rbac'
import { getUserNameMap } from '../utils/user-names'

// Servicio de ideas (fase 4, RT-4): la lógica vive aquí y los handlers de
// `server/api/ideas/*` son envoltorios finos. El servidor MCP y el bot la reutilizan.

export const IDEA_STATUS_VALUES = ['discussion', 'promoted', 'discarded'] as const

export const createIdeaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1)
})

export const ideaStatusSchema = z.object({ status: z.enum(['discussion', 'discarded']) })

// Las descartadas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera.
export async function listIdeas() {
  const rows = await db.query.ideas.findMany({ where: ne(ideas.status, 'discarded'), orderBy: [desc(ideas.createdAt)] })
  const nameMap = await getUserNameMap(rows.map(i => i.authorId))
  return rows.map(i => ({ ...i, authorName: nameMap.get(i.authorId) ?? i.authorId }))
}

export async function getIdeaDetail(ideaId: string) {
  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, ideaId) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }

  const comments = await db.query.ideaComments.findMany({
    where: eq(ideaComments.ideaId, ideaId),
    orderBy: (c, { asc }) => [asc(c.createdAt)]
  })
  const photos = await db.query.media.findMany({
    where: eq(media.ideaId, ideaId),
    orderBy: (m, { desc }) => [desc(m.createdAt)]
  })
  const nameMap = await getUserNameMap([idea.authorId, ...comments.map(c => c.authorId)])

  return {
    idea: { ...idea, authorName: nameMap.get(idea.authorId) ?? idea.authorId },
    comments: comments.map(c => ({ ...c, authorName: nameMap.get(c.authorId) ?? c.authorId })),
    media: await resolveMediaUrls(photos)
  }
}

export async function createIdea(input: { actor: SessionUser, title: string, description: string }) {
  const [idea] = await db.insert(ideas)
    .values({ title: input.title, description: input.description, authorId: input.actor.id })
    .returning()
  if (!idea) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la idea' })
  }
  return idea
}

// Solo Admin o el autor cambian el estado. 'discarded' es siempre final; una idea ya promovida
// solo puede archivarse (el promote copió título y descripción a la propuesta en su momento).
export async function changeIdeaStatus(input: {
  actor: SessionUser
  ideaId: string
  status: 'discussion' | 'discarded'
}) {
  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, input.ideaId) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }
  if (idea.status === 'discarded') {
    throw createError({ statusCode: 400, statusMessage: 'Esta idea ya está descartada' })
  }
  if (input.actor.role !== 'admin' && idea.authorId !== input.actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el autor pueden cambiar el estado' })
  }
  if (idea.status === 'promoted' && input.status !== 'discarded') {
    throw createError({ statusCode: 400, statusMessage: 'Una idea ya promovida solo puede archivarse (descartarse)' })
  }

  const [updated] = await db.update(ideas)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(ideas.id, input.ideaId))
    .returning()

  await writeAuditLog({
    actorId: input.actor.id,
    action: 'idea_status_changed',
    entityType: 'idea',
    entityId: input.ideaId,
    metadata: { status: input.status }
  })

  return updated!
}

// Borrado definitivo: solo Admin, y solo desde la papelera (idea ya descartada). No se puede
// borrar una idea que dio origen a una propuesta que sigue existiendo (FK sin cascada, a
// propósito) — se devuelve un mensaje claro en vez de un error crudo de Postgres.
export async function deleteIdeaPermanently(input: { actor: SessionUser, ideaId: string }) {
  return db.transaction(async (tx) => {
    const [idea] = await tx.select().from(ideas).where(eq(ideas.id, input.ideaId)).for('update')
    if (!idea) {
      throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
    }
    if (idea.status !== 'discarded') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una idea descartada' })
    }

    const linkedProposal = await tx.query.proposals.findFirst({ where: eq(proposals.originIdeaId, input.ideaId) })
    if (linkedProposal) {
      throw createError({
        statusCode: 400,
        statusMessage: `No se puede eliminar: esta idea dio origen a la propuesta "${linkedProposal.title}", que todavía existe`
      })
    }

    await tx.delete(ideas).where(eq(ideas.id, input.ideaId))

    await writeAuditLog({
      actorId: input.actor.id,
      action: 'idea_deleted_permanently',
      entityType: 'idea',
      entityId: input.ideaId,
      metadata: { title: idea.title }
    }, tx)

    return { success: true as const }
  })
}
