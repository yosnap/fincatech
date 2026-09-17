import { computeRunningBalance } from '../../../services/bank-core'
import { listTransactions } from '../../../services/bank-service'
import { requireRole } from '../../../utils/rbac'

// Lista completa de movimientos con el saldo acumulado por fila. Información comunal:
// cualquier autenticado la ve (el Invitado incluido). Paginación en cliente (patrón del
// libro contable): con el volumen de una finca la lista completa es barata.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const transactions = await listTransactions()
  return { transactions: computeRunningBalance(transactions) }
})
