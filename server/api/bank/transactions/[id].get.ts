import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { bankTransactions } from '../../../db/schema'
import { requireRole } from '../../../utils/rbac'

// Detalle de un movimiento bancario. Información comunal: cualquier autenticado.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  const [transaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id))
  if (!transaction) {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  }
  return { transaction }
})
