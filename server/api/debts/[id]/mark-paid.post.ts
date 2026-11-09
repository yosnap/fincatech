import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { debts, expenses } from '../../../db/schema'
import { markDebtPaid } from '../../../services/expense-service'
import { uploadFile } from '../../../services/storage'
import { matchesDeclaredType } from '../../../utils/file-signature'
import { requireRole } from '../../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

// Solo el deudor marca su propia cuota como pagada. El comprobante es opcional — si no se
// sube, la cuota igual queda "pendiente de confirmación" hasta que el acreedor/Admin la
// confirme (ver markDebtPaid en expense-service.ts).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const debtId = getRouterParam(event, 'id')
  if (!debtId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de cuota' })
  }

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, debtId) })
  if (!debt) {
    throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
  }
  if (debt.debtorId !== actor.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el deudor puede marcar esta cuota como pagada' })
  }

  // Comprobación temprana para no subir el comprobante a MinIO y borrarlo después; el
  // servicio (markDebtPaid) vuelve a comprobarlo bloqueando el gasto (RT8-5).
  const [expense] = await db.select({ deletedAt: expenses.deletedAt })
    .from(expenses).where(eq(expenses.id, debt.expenseId))
  if (expense?.deletedAt) {
    throw createError({ statusCode: 409, statusMessage: 'El gasto está en la papelera: no se puede marcar la cuota como pagada' })
  }

  const formData = await readMultipartFormData(event).catch(() => null)
  const file = formData?.find(part => part.name === 'proof' && part.filename)
  let proof: { objectName: string, contentType: string } | undefined

  if (file) {
    if (!file.type || !ALLOWED_TYPES.has(file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'Comprobante inválido (JPEG, PNG o PDF)' })
    }
    if (file.data.length > MAX_SIZE_BYTES) {
      throw createError({ statusCode: 400, statusMessage: 'El comprobante supera el límite de 10MB' })
    }
    const buffer = Buffer.from(file.data)
    // El Content-Type del multipart lo declara el cliente; verificamos los bytes reales del
    // archivo para que no baste con renombrar/mentir la extensión para saltarse el filtro.
    if (!matchesDeclaredType(buffer, file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
    }
    const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
    const objectName = `debts/${debtId}/${randomUUID()}.${extension}`
    await uploadFile(objectName, buffer, file.type)
    proof = { objectName, contentType: file.type }
  }

  const updated = await markDebtPaid({ debtId, actorId: actor.id, proof })

  return { debt: updated }
})
