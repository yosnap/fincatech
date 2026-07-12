import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access'

// Solo definimos roles para que el plugin admin de Better Auth tipe 'admin' | 'owner' | 'guest'.
// La autorización real de la app usa server/utils/rbac.ts (requireRole/canSeeIndividualDebt),
// no el sistema de permisos granular de este access controller.
const statement = { ...defaultStatements } as const

export const ac = createAccessControl(statement)

export const adminRole = ac.newRole({ ...adminAc.statements })
export const ownerRole = ac.newRole({})
export const guestRole = ac.newRole({})
