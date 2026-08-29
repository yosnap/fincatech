import { describe, expect, it } from 'vitest'
import { computeSettlement, type SettlementInputDebt, type SettlementInputExpense } from './settlement-core'

const T0 = new Date('2026-01-01T10:00:00Z')
const T1 = new Date('2026-02-01T10:00:00Z')
const T2 = new Date('2026-03-01T10:00:00Z')

function debt(partial: Partial<SettlementInputDebt>): SettlementInputDebt {
  return {
    id: partial.id ?? `debt-${Math.random().toString(36).slice(2)}`,
    expenseId: 'expense-1',
    debtorId: 'me',
    creditorId: 'a',
    amountCents: 1000,
    status: 'pending',
    createdAt: T0,
    ...partial
  }
}

function expense(partial: Partial<SettlementInputExpense>): SettlementInputExpense {
  return {
    id: 'expense-1',
    description: 'Recibo',
    createdBy: 'me',
    amountCents: 1000,
    ...partial
  }
}

const USERS = [
  { id: 'me', name: 'Yo' },
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bea' },
  { id: 'c', name: 'Carlos' }
]

describe('computeSettlement', () => {
  it('escenario de 4 personas: Ana gastó 2000, yo 1500 → mi parte de lo suyo (500) menos su parte de lo mío (375) = le debo 125', () => {
    const allDebts = [
      // Ana subió recibos por 2000€ con 4 participantes → cada uno le debe 500€.
      debt({ expenseId: 'e-ana', debtorId: 'me', creditorId: 'a', amountCents: 50_000, createdAt: T1 }),
      debt({ expenseId: 'e-ana', debtorId: 'b', creditorId: 'a', amountCents: 50_000, createdAt: T1 }),
      debt({ expenseId: 'e-ana', debtorId: 'c', creditorId: 'a', amountCents: 50_000, createdAt: T1 }),
      // Yo subí recibos por 1500€ con 4 participantes → cada uno me debe 375€.
      debt({ expenseId: 'e-me', debtorId: 'a', creditorId: 'me', amountCents: 37_500, createdAt: T2 })
    ]
    const allExpenses = [
      expense({ id: 'e-ana', createdBy: 'a', amountCents: 200_000, description: 'Recibos de Ana' }),
      expense({ id: 'e-me', createdBy: 'me', amountCents: 150_000, description: 'Mis recibos' })
    ]

    const result = computeSettlement('me', allDebts, allExpenses, USERS, true)

    expect(result.counterparties).toHaveLength(1)
    const ana = result.counterparties[0]!
    expect(ana.userId).toBe('a')
    expect(ana.name).toBe('Ana')
    expect(ana.iOweThemCents).toBe(50_000)
    expect(ana.theyOweMeCents).toBe(37_500)
    expect(ana.netCents).toBe(-12_500) // le debo 125€
    expect(ana.totalSpentCents).toBe(200_000)
    expect(result.totalIOweThemCents).toBe(50_000)
    expect(result.totalTheyOweMeCents).toBe(37_500)
    expect(result.totalNetCents).toBe(-12_500)
  })

  it('las deudas confirmadas (pagadas) no participan en la liquidación', () => {
    const allDebts = [
      debt({ debtorId: 'me', creditorId: 'a', amountCents: 10_000, status: 'confirmed' }),
      debt({ debtorId: 'a', creditorId: 'me', amountCents: 4_000, status: 'pending' })
    ]

    const result = computeSettlement('me', allDebts, [], USERS, true)

    expect(result.counterparties[0]!.iOweThemCents).toBe(0)
    expect(result.counterparties[0]!.theyOweMeCents).toBe(4_000)
    expect(result.totalNetCents).toBe(4_000)
  })

  it('pending_confirmation cuenta como deuda viva (el acreedor aún no lo confirmó)', () => {
    const allDebts = [
      debt({ debtorId: 'me', creditorId: 'a', amountCents: 10_000, status: 'pending_confirmation' })
    ]

    const result = computeSettlement('me', allDebts, [], USERS, true)

    expect(result.counterparties[0]!.iOweThemCents).toBe(10_000)
  })

  it('sin deudas vivas no hay contrapartes y los totales son 0', () => {
    const result = computeSettlement('me', [], [], USERS, true)

    expect(result.counterparties).toEqual([])
    expect(result.totalNetCents).toBe(0)
  })

  it('los recibos subidos por cada persona se agregan como contexto global (totalSpentCents)', () => {
    const allDebts = [debt({ debtorId: 'me', creditorId: 'a', amountCents: 1_000 })]
    const allExpenses = [
      expense({ id: 'e-1', createdBy: 'a', amountCents: 60_000 }),
      expense({ id: 'e-2', createdBy: 'a', amountCents: 40_000 }),
      expense({ id: 'e-3', createdBy: 'b', amountCents: 25_000 })
    ]

    const result = computeSettlement('me', allDebts, allExpenses, USERS, true)

    const byId = new Map(result.counterparties.map(c => [c.userId, c]))
    expect(byId.get('a')?.totalSpentCents).toBe(100_000)
  })

  it('al Invitado (includeSpentTotals=false) no se le expone cuánto ha gastado cada persona', () => {
    const allDebts = [debt({ debtorId: 'me', creditorId: 'a', amountCents: 1_000 })]
    const allExpenses = [expense({ createdBy: 'a', amountCents: 60_000 })]

    const result = computeSettlement('me', allDebts, allExpenses, USERS, false)

    expect(result.counterparties[0]!.totalSpentCents).toBeNull()
  })

  it('compensación total: la diferencia es 0 aunque queden líneas pendientes en ambos sentidos', () => {
    const allDebts = [
      debt({ debtorId: 'me', creditorId: 'a', amountCents: 50_000, createdAt: T0 }),
      debt({ debtorId: 'a', creditorId: 'me', amountCents: 50_000, createdAt: T1 })
    ]

    const result = computeSettlement('me', allDebts, [], USERS, true)

    const ana = result.counterparties[0]!
    expect(ana.netCents).toBe(0)
    expect(ana.theyOweMeLines).toHaveLength(1)
    expect(ana.iOweThemLines).toHaveLength(1)
  })

  it('ordena contrapartes por |diferencia| descendente y agrupa varias recibos por persona', () => {
    const allDebts = [
      debt({ id: 'd1', expenseId: 'e-1', debtorId: 'me', creditorId: 'b', amountCents: 30_000, createdAt: T0 }),
      debt({ id: 'd2', expenseId: 'e-2', debtorId: 'me', creditorId: 'b', amountCents: 20_000, createdAt: T1 }),
      debt({ id: 'd3', expenseId: 'e-3', debtorId: 'a', creditorId: 'me', amountCents: 10_000, createdAt: T2 }),
      debt({ id: 'd4', expenseId: 'e-4', debtorId: 'a', creditorId: 'me', amountCents: 5_000, createdAt: T0 })
    ]

    const result = computeSettlement('me', allDebts, [
      expense({ id: 'e-1', description: 'B uno' }),
      expense({ id: 'e-2', description: 'B dos' }),
      expense({ id: 'e-3', description: 'A uno' }),
      expense({ id: 'e-4', description: 'A dos' })
    ], USERS, true)

    expect(result.counterparties.map(c => c.userId)).toEqual(['b', 'a'])
    const bea = result.counterparties[0]!
    expect(bea.iOweThemCents).toBe(50_000)
    expect(bea.iOweThemLines.map(l => l.description)).toEqual(['B uno', 'B dos'])
    const ana = result.counterparties[1]!
    expect(ana.theyOweMeCents).toBe(15_000)
    expect(ana.theyOweMeLines.map(l => l.description)).toEqual(['A dos', 'A uno'])
  })

  it('ignora deudas de una persona consigo misma y deudas entre terceros', () => {
    const allDebts = [
      debt({ debtorId: 'a', creditorId: 'a', amountCents: 99_999 }),
      debt({ debtorId: 'b', creditorId: 'c', amountCents: 99_999 })
    ]

    const result = computeSettlement('me', allDebts, [], USERS, true)

    expect(result.counterparties).toEqual([])
  })
})
