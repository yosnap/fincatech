import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import { canSeeIndividualDebt, requireRole, type SessionUser } from './rbac'

function eventWithUser(user: SessionUser | null): H3Event {
  return { context: { user } } as H3Event
}

function statusCodeOf(fn: () => unknown): number | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
}

describe('requireRole', () => {
  it('lanza 401 si no hay sesión', () => {
    expect(statusCodeOf(() => requireRole(eventWithUser(null), ['admin']))).toBe(401)
  })

  it('lanza 403 si un guest pide un endpoint de admin', () => {
    const event = eventWithUser({ id: '1', role: 'guest', banned: false })
    expect(statusCodeOf(() => requireRole(event, ['admin']))).toBe(403)
  })

  it('devuelve el usuario si su rol está permitido', () => {
    const user: SessionUser = { id: '1', role: 'admin', banned: false }
    expect(requireRole(eventWithUser(user), ['admin', 'owner'])).toEqual(user)
  })
})

describe('canSeeIndividualDebt', () => {
  it('es false para guest (solo ve agregados, nunca desglose individual)', () => {
    expect(canSeeIndividualDebt({ id: '1', role: 'guest', banned: false })).toBe(false)
  })

  it('es false sin sesión', () => {
    expect(canSeeIndividualDebt(null)).toBe(false)
  })

  it('es true para owner y admin', () => {
    expect(canSeeIndividualDebt({ id: '1', role: 'owner', banned: false })).toBe(true)
    expect(canSeeIndividualDebt({ id: '2', role: 'admin', banned: false })).toBe(true)
  })
})
