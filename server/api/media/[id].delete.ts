import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { media } from '../../db/schema'
import { deleteFile } from '../../services/storage'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

// Endpoint genérico: 'media' es polimórfica (foto de tarea, galería general, idea o
// propuesta) — un único endpoint de borrado sirve para las cuatro, ya que el permiso
// (quien subió la foto, o Admin) y la limpieza (fila + objeto real en MinIO) son iguales
// sin importar a qué está enganchada la foto.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de foto' })
  }

  const item = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Foto no encontrada' })
  }
  if (actor.role !== 'admin' && item.uploadedBy !== actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo quien subió la foto o un Admin puede borrarla' })
  }

  // Se borra primero la fila (fuente de verdad de lo que ve el usuario) y después el
  // objeto real en MinIO: si el segundo paso fallara, el peor caso es un objeto huérfano
  // en el bucket (invisible, sin impacto de UX) en vez de una foto fantasma que sigue
  // listada pero ya no se puede abrir.
  await db.delete(media).where(eq(media.id, id))
  await deleteFile(item.objectName)

  await writeAuditLog({
    actorId: actor.id,
    action: 'media_deleted',
    entityType: 'media',
    entityId: id,
    metadata: { objectName: item.objectName, taskId: item.taskId, ideaId: item.ideaId, proposalId: item.proposalId }
  })

  return { success: true }
})
