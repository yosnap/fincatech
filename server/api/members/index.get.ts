import { auth } from '../../utils/auth'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const { users } = await auth.api.listUsers({
    query: { sortBy: 'name', sortDirection: 'asc' },
    headers: event.headers
  })

  return {
    members: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? 'guest',
      banned: u.banned ?? false,
      createdAt: u.createdAt
    }))
  }
})
