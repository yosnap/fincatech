import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../../db/client'
import { media, tasks } from '../../../../db/schema'
import { uploadFile } from '../../../../services/storage'
import { matchesDeclaredType } from '../../../../utils/file-signature'
import { requireRole } from '../../../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const typeSchema = z.enum(['before', 'after', 'general'])

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de tarea' })
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Tarea no encontrada' })
  }

  const formData = await readMultipartFormData(event)
  const typeRaw = formData?.find(part => part.name === 'type')?.data.toString('utf8') ?? 'general'
  const typeParsed = typeSchema.safeParse(typeRaw)
  if (!typeParsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Tipo de foto inválido (before, after o general)' })
  }

  const file = formData?.find(part => part.name === 'file')
  if (!file?.type || !ALLOWED_TYPES.has(file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'Sube una imagen JPEG o PNG' })
  }
  const buffer = Buffer.from(file.data)
  if (buffer.length > MAX_SIZE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'La imagen supera el límite de 10MB' })
  }
  if (!matchesDeclaredType(buffer, file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
  }

  const extension = file.type === 'image/png' ? 'png' : 'jpg'
  const objectName = `tasks/${taskId}/${randomUUID()}.${extension}`
  await uploadFile(objectName, buffer, file.type)

  const [item] = await db.insert(media).values({
    objectName,
    contentType: file.type,
    type: typeParsed.data,
    taskId,
    uploadedBy: actor.id
  }).returning()
  if (!item) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar la foto' })
  }

  return { media: { id: item.id, type: item.type, createdAt: item.createdAt } }
})
