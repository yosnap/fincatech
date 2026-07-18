import { getExpenseStatistics } from '../../services/dashboard-service'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  return getExpenseStatistics(actor)
})
