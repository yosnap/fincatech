import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideaComments, ideas, media } from '../../db/schema'
import { requireRole } from '../../utils/rbac'
import { getUserNameMap } from '../../utils/user-names'
import { resolveMediaUrls } from '../../utils/media-urls'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, id) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }

  const comments = await db.query.ideaComments.findMany({
    where: eq(ideaComments.ideaId, id),
    orderBy: (c, { asc }) => [asc(c.createdAt)]
  })

  const photos = await db.query.media.findMany({
    where: eq(media.ideaId, id),
    orderBy: (m, { desc }) => [desc(m.createdAt)]
  })

  const nameMap = await getUserNameMap([idea.authorId, ...comments.map(c => c.authorId)])

  return {
    idea: { ...idea, authorName: nameMap.get(idea.authorId) ?? idea.authorId },
    comments: comments.map(c => ({ ...c, authorName: nameMap.get(c.authorId) ?? c.authorId })),
    media: await resolveMediaUrls(photos)
  }
})
