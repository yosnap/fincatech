import { and, desc, gte, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { media } from '../../db/schema'
import { requireRole } from '../../utils/rbac'
import { resolveMediaUrls } from '../../utils/media-urls'

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

// Fotos de galería general: media.taskId IS NULL (las de tareas quedan fuera, ver Fase 7).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Parámetros de fecha inválidos (YYYY-MM-DD)' })
  }

  const conditions = [isNull(media.taskId)]
  if (parsed.data.start) {
    conditions.push(gte(media.createdAt, new Date(parsed.data.start)))
  }
  if (parsed.data.end) {
    const end = new Date(parsed.data.end)
    end.setUTCHours(23, 59, 59, 999)
    conditions.push(lte(media.createdAt, end))
  }

  // Tope duro: cada fila implica una llamada a MinIO para firmar su URL (resolveMediaUrls).
  // Sin límite, una galería con historial de meses/años dispararía cientos de llamadas a
  // MinIO en cada carga de página — antes de este endpoint devolver URLs, no importaba
  // (solo metadatos); ahora sí. 60 fotos más recientes es suficiente para una miniatura de
  // galería sin necesitar paginación todavía.
  const rows = await db.query.media.findMany({
    where: and(...conditions),
    orderBy: [desc(media.createdAt)],
    limit: 60
  })
  return { media: await resolveMediaUrls(rows) }
})
