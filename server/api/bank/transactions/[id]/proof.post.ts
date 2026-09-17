import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { bankTransactions } from '../../../../db/schema'
import { attachTransactionProof } from '../../../../services/bank-service'
import { deleteFile, uploadFile } from '../../../../services/storage'
import { matchesDeclaredType } from '../../../../utils/file-signature'
import { requireRole } from '../../../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

// Adjuntar el justificante DESPUÉS de crear el movimiento (hasProof false → true), solo
// Admin. Multipart con un único campo `proof`; misma validación de archivo que expenses.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const transactionId = getRouterParam(event, 'id')
  if (!transactionId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  const [existing] = await db.select({ hasProof: bankTransactions.hasProof })
    .from(bankTransactions).where(eq(bankTransactions.id, transactionId))
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  }
  if (existing.hasProof) {
    throw createError({ statusCode: 409, statusMessage: 'El movimiento ya tiene justificante' })
  }

  const formData = await readMultipartFormData(event)
  const file = formData?.find(part => part.name === 'proof')
  if (!file?.type || !ALLOWED_TYPES.has(file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'Justificante requerido (JPEG, PNG o PDF)' })
  }
  const buffer = Buffer.from(file.data)
  if (buffer.length > MAX_SIZE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'El justificante supera el límite de 10MB' })
  }
  if (!matchesDeclaredType(buffer, file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
  }

  const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
  const objectName = `bank/transactions/${randomUUID()}.${extension}`
  try {
    await uploadFile(objectName, buffer, file.type)
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo subir el justificante' })
  }

  try {
    const transaction = await attachTransactionProof({ transactionId, actorId: actor.id, proof: { objectName, contentType: file.type } })
    return { transaction }
  } catch (error) {
    await deleteFile(objectName).catch(() => null)
    throw error
  }
})
