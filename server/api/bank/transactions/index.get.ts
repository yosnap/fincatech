import { computeRunningBalance } from '../../../services/bank-core'
import { listTransactions } from '../../../services/bank-service'
import { linkedAmountByTransaction } from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'

// Lista completa de movimientos con el saldo acumulado por fila. Información comunal:
// cualquier autenticado la ve (el Invitado incluido). Paginación en cliente (patrón del
// libro contable): con el volumen de una finca la lista completa es barata.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const [transactions, linked] = await Promise.all([listTransactions(), linkedAmountByTransaction()])
  // `linkedCents`: parte del ingreso ya cubierta por aportes (para ofrecer solo los que tienen hueco).
  return {
    transactions: computeRunningBalance(transactions).map(t => ({ ...t, linkedCents: linked.get(t.id) ?? 0 }))
  }
})
