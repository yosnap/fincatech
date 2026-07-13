import { randomUUID } from 'node:crypto'
import { db } from '../../db/client'
import { media } from '../../db/schema'
import { uploadFile } from '../../services/storage'
import { matchesDeclaredType } from '../../utils/file-signature'
import { requireRole } from '../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const formData = await readMultipartFormData(event)
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
  const objectName = `gallery/${randomUUID()}.${extension}`
  await uploadFile(objectName, buffer, file.type)

  const [item] = await db.insert(media).values({
    objectName,
    contentType: file.type,
    type: 'general',
    taskId: null,
    uploadedBy: actor.id
  }).returning()
  if (!item) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar la foto' })
  }

  return { media: { id: item.id, type: item.type, createdAt: item.createdAt } }
})
