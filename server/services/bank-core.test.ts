import { describe, expect, it } from 'vitest'
import {
  addMonths,
  buildQuotaGrid,
  buildTransferDescription,
  computeBalances,
  computeFondoComun,
  computeReconciliation,
  computeRunningBalance,
  expandQuotaPeriods,
  isValidPeriod,
  monthRange,
  type BankTransactionCore,
  type ContributionCore
} from './bank-core'

const T0 = new Date('2026-01-01T10:00:00Z')
const T1 = new Date('2026-02-01T10:00:00Z')

function tx(partial: Partial<BankTransactionCore> = {}): BankTransactionCore {
  return {
    id: partial.id ?? `tx-${Math.random().toString(36).slice(2)}`,
    date: '2026-01-15',
    direction: 'deposit',
    amountCents: 10_000,
    description: 'Movimiento',
    category: null,
    createdAt: T0,
    ...partial
  }
}

function contribution(partial: Partial<ContributionCore> = {}): ContributionCore {
  return {
    id: partial.id ?? `c-${Math.random().toString(36).slice(2)}`,
    memberId: 'a',
    amountCents: 5_000,
    type: 'quota',
    period: '2026-09',
    method: 'transfer',
    date: '2026-09-01',
    bankTransactionId: null,
    ...partial
  }
}

const MEMBERS = [
  { id: 'c', name: 'Carlos' },
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bea' }
]

describe('computeRunningBalance', () => {
  it('saldo acumulado con mezcla de ingresos/salidas y fechas desordenadas', () => {
    const result = computeRunningBalance([
      tx({ id: '3', date: '2026-03-01', direction: 'withdrawal', amountCents: 3_000 }),
      tx({ id: '1', date: '2026-01-01', direction: 'deposit', amountCents: 10_000 }),
      tx({ id: '2', date: '2026-02-01', direction: 'deposit', amountCents: 5_000 })
    ])

    expect(result.map(r => r.id)).toEqual(['1', '2', '3'])
    expect(result.map(r => r.balanceCentsAfter)).toEqual([10_000, 15_000, 12_000])
  })

  it('desempate estable por createdAt e id cuando la fecha coincide', () => {
    const result = computeRunningBalance([
      tx({ id: 'z', date: '2026-01-01', createdAt: T1 }),
      tx({ id: 'a', date: '2026-01-01', createdAt: T0 })
    ])
    expect(result.map(r => r.id)).toEqual(['a', 'z'])
  })

  it('no muta el array original', () => {
    const original = [tx({ date: '2026-02-01' }), tx({ date: '2026-01-01' })]
    computeRunningBalance(original)
    expect(original[0]!.date).toBe('2026-02-01')
  })
})

describe('computeBalances', () => {
  it('saldo actual y pre-compra; el movimiento EN la fecha de compra queda excluido (estricto <)', () => {
    const transactions = [
      tx({ id: 'pre', date: '2026-05-30', direction: 'deposit', amountCents: 50_000 }),
      tx({ id: 'same-day', date: '2026-06-01', direction: 'deposit', amountCents: 20_000 }),
      tx({ id: 'post', date: '2026-07-01', direction: 'withdrawal', amountCents: 5_000 })
    ]

    const balances = computeBalances(transactions, '2026-06-01')
    expect(balances.prePurchaseCents).toBe(50_000)
    expect(balances.currentCents).toBe(65_000)
  })

  it('sin fecha de compra configurada el saldo pre-compra es 0', () => {
    const balances = computeBalances([tx({ amountCents: 1_000 })], null)
    expect(balances.prePurchaseCents).toBe(0)
    expect(balances.currentCents).toBe(1_000)
  })
})

describe('computeReconciliation', () => {
  it('aporte en efectivo sin vincular cuenta como efectivo pendiente', () => {
    const result = computeReconciliation([], [
      contribution({ method: 'cash', amountCents: 5_000 }),
      contribution({ method: 'cash', amountCents: 2_500 })
    ])
    expect(result.cashPendingCents).toBe(7_500)
    expect(result.cashPending).toHaveLength(2)
  })

  it('transferencia auto-vinculada NO queda pendiente ni genera ingreso sin origen', () => {
    const result = computeReconciliation(
      [tx({ id: 'tx-1', direction: 'deposit', amountCents: 5_000 })],
      [contribution({ method: 'transfer', bankTransactionId: 'tx-1' })]
    )
    expect(result.cashPendingCents).toBe(0)
    expect(result.unmatchedDeposits).toHaveLength(0)
  })

  it('depósito externo categorizado no cuenta como ingreso sin origen', () => {
    const result = computeReconciliation(
      [tx({ direction: 'deposit', category: 'hacienda', amountCents: 30_000 })],
      []
    )
    expect(result.unmatchedDeposits).toHaveLength(0)
  })

  it('depósito sin aporte vinculado ni categoría aparece como ingreso sin origen', () => {
    const result = computeReconciliation(
      [tx({ id: 'tx-2', direction: 'deposit' })],
      []
    )
    expect(result.unmatchedDeposits.map(d => d.id)).toEqual(['tx-2'])
  })

  it('un depósito puede amparar varios aportes en efectivo (mismo ingreso, dos miembros)', () => {
    const result = computeReconciliation(
      [tx({ id: 'tx-3', direction: 'deposit', amountCents: 7_500 })],
      [
        contribution({ memberId: 'a', method: 'cash', bankTransactionId: 'tx-3' }),
        contribution({ memberId: 'b', method: 'cash', bankTransactionId: 'tx-3' })
      ]
    )
    expect(result.cashPendingCents).toBe(0)
    expect(result.unmatchedDeposits).toHaveLength(0)
  })

  it('las salidas nunca aparecen como ingresos sin origen', () => {
    const result = computeReconciliation([tx({ direction: 'withdrawal' })], [])
    expect(result.unmatchedDeposits).toHaveLength(0)
  })
})

describe('computeFondoComun', () => {
  it('partes iguales con resto: Σ partes = Σ salidas exacto y el resto va al primer id alfabético', () => {
    // Salidas 10.000 céntimos entre 3 miembros → 3333,33... → 3334 + 3333 + 3333.
    const transactions = [tx({ direction: 'withdrawal', amountCents: 10_000 })]
    const contributions = [
      contribution({ memberId: 'a', amountCents: 20_000, type: 'pre_purchase', period: null }),
      contribution({ memberId: 'b', amountCents: 15_000, type: 'quota' })
    ]

    const result = computeFondoComun(contributions, transactions, MEMBERS)

    expect(result.map(r => r.memberId)).toEqual(['a', 'b', 'c'])
    expect(result.map(r => r.withdrawalsShareCents)).toEqual([3334, 3333, 3333])
    expect(result.map(r => r.balanceCents)).toEqual([20_000 - 3334, 15_000 - 3333, 0 - 3333])
    // Invariante documentada: Σ partes de salidas = total de salidas exacto.
    expect(result.reduce((sum, r) => sum + r.withdrawalsShareCents, 0)).toBe(10_000)
  })

  it('los depósitos externos NO se acreditan a nadie: crecen el bote, no el saldo por miembro', () => {
    const transactions = [
      tx({ direction: 'withdrawal', amountCents: 9_000 }),
      tx({ direction: 'deposit', category: 'iva', amountCents: 100_000 })
    ]
    const contributions = [contribution({ memberId: 'a', amountCents: 3_000 })]

    const result = computeFondoComun(contributions, transactions, MEMBERS)

    // 9000/3 = 3000 exacto por miembro; el ingreso externo no toca la fórmula.
    expect(result.every(r => r.withdrawalsShareCents === 3_000)).toBe(true)
    expect(result[0]!.balanceCents).toBe(0)
  })

  it('miembro sin aportes tiene saldo negativo igual a su parte de las salidas', () => {
    const result = computeFondoComun([], [tx({ direction: 'withdrawal', amountCents: 6_000 })], MEMBERS)
    expect(result.every(r => r.balanceCents === -2_000)).toBe(true)
  })

  it('sin miembros activos devuelve lista vacía (evita división por cero)', () => {
    expect(computeFondoComun([contribution()], [tx({ direction: 'withdrawal' })], [])).toEqual([])
  })

  it('Σ saldos = contribuciones totales − salidas totales', () => {
    const transactions = [tx({ direction: 'withdrawal', amountCents: 10_000 })]
    const contributions = [
      contribution({ memberId: 'a', amountCents: 20_000 }),
      contribution({ memberId: 'b', amountCents: 15_000 }),
      contribution({ memberId: 'c', amountCents: 10_000 })
    ]
    const result = computeFondoComun(contributions, transactions, MEMBERS)
    expect(result.reduce((sum, r) => sum + r.balanceCents, 0)).toBe(45_000 - 10_000)
  })
})

describe('utilidades de período', () => {
  it('isValidPeriod acepta YYYY-MM válido y rechaza el resto', () => {
    expect(isValidPeriod('2026-08')).toBe(true)
    expect(isValidPeriod('2026-13')).toBe(false)
    expect(isValidPeriod('2026-8')).toBe(false)
    expect(isValidPeriod('nope')).toBe(false)
  })

  it('addMonths rueda el año correctamente', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-08', 0)).toBe('2026-08')
  })

  it('monthRange devuelve el rango inclusive y [] si falta o está invertido', () => {
    expect(monthRange('2026-08', '2026-10')).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(monthRange('2026-10', '2026-08')).toEqual([])
    expect(monthRange(null, '2026-10')).toEqual([])
  })

  it('expandQuotaPeriods genera los meses consecutivos del adelanto', () => {
    expect(expandQuotaPeriods('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(expandQuotaPeriods('2026-09', 1)).toEqual(['2026-09'])
  })

  it('buildTransferDescription: cuota única, adelanto y aportes no-cuota', () => {
    expect(buildTransferDescription('quota', ['2026-09'], 'Ana')).toBe('Cuota 2026-09 — Ana')
    expect(buildTransferDescription('quota', ['2026-11', '2026-12', '2027-01'], 'Ana')).toBe('Cuotas 2026-11 a 2027-01 — Ana')
    expect(buildTransferDescription('pre_purchase', [], 'Ana')).toBe('Aporte pre-compra — Ana')
    expect(buildTransferDescription('extraordinary', [], 'Ana')).toBe('Aporte extraordinario — Ana')
  })
})

describe('buildQuotaGrid', () => {
  it('grid desde quotaStartMonth hasta el mes actual con pagado/pendiente por miembro', () => {
    const quotaContributions = [
      contribution({ memberId: 'a', period: '2026-08', bankTransactionId: 'tx-1' }),
      contribution({ memberId: 'b', period: '2026-08' })
    ]

    const grid = buildQuotaGrid(MEMBERS, quotaContributions, '2026-08', '2026-09')

    expect(grid.map(m => m.period)).toEqual(['2026-08', '2026-09'])
    const august = grid[0]!
    expect(august.isFuture).toBe(false)
    expect(august.cells.find(c => c.memberId === 'a')!.contribution).not.toBeNull()
    expect(august.cells.find(c => c.memberId === 'c')!.contribution).toBeNull()
    expect(grid[1]!.cells.every(c => c.contribution === null)).toBe(true)
  })

  it('mes anterior a quotaStartMonth no aparece', () => {
    const grid = buildQuotaGrid(MEMBERS, [], '2026-08', '2026-09')
    expect(grid.map(m => m.period)).not.toContain('2026-07')
  })

  it('mes futuro pagado por adelantado aparece al final marcado isFuture', () => {
    const quotaContributions = [
      contribution({ memberId: 'a', period: '2026-10' })
    ]

    const grid = buildQuotaGrid(MEMBERS, quotaContributions, '2026-08', '2026-09')

    expect(grid.map(m => m.period)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(grid[2]!.isFuture).toBe(true)
    expect(grid[2]!.cells.find(c => c.memberId === 'a')!.contribution).not.toBeNull()
  })

  it('sin quotaStartMonth configurado el grid está vacío salvo meses adelantados', () => {
    const quotaContributions = [contribution({ memberId: 'a', period: '2026-10' })]
    const grid = buildQuotaGrid(MEMBERS, quotaContributions, null, '2026-09')
    expect(grid.map(m => m.period)).toEqual(['2026-10'])
  })
})
