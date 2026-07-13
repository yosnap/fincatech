import { getDashboardSummary } from '../services/dashboard-service'
import { requireRole } from '../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const summary = await getDashboardSummary(actor)
  return summary
})
