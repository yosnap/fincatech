import { describe, expect, it } from 'vitest'
import {
  amountForMonth,
  chargeDateFor,
  findManualCandidates,
  lastDayOfMonth,
  MIN_MORTGAGE_MONTH,
  mortgageMonthRange,
  planMortgageCharges,
  type MortgageCandidateInput,
  type MortgageScheduleEntry
} from './mortgage-core'

function entry(partial: Partial<MortgageScheduleEntry>): MortgageScheduleEntry {
  return {
    id: partial.id ?? `s-${Math.random().toString(36).slice(2)}`,
    amountCents: partial.amountCents ?? 50_000,
    chargeDay: partial.chargeDay ?? 1,
    effectiveFrom: partial.effectiveFrom ?? MIN_MORTGAGE_MONTH,
    ...partial
  }
}

function candidate(partial: Partial<MortgageCandidateInput>): MortgageCandidateInput {
  return {
    id: partial.id ?? `t-${Math.random().toString(36).slice(2)}`,
    date: partial.date ?? '2026-09-01',
    direction: partial.direction ?? 'withdrawal',
    amountCents: partial.amountCents ?? 50_000,
    description: partial.description ?? 'Transferencia',
    mortgagePeriod: partial.mortgagePeriod ?? null,
    deletedAt: partial.deletedAt ?? null,
    ...partial
  }
}

describe('lastDayOfMonth / chargeDateFor', () => {
  it('recorta el día 31 al último día real del mes', () => {
    expect(lastDayOfMonth('2026-02')).toBe(28)
    expect(lastDayOfMonth('2028-02')).toBe(29)
    expect(lastDayOfMonth('2026-04')).toBe(30)
    expect(lastDayOfMonth('2026-12')).toBe(31)
    expect(chargeDateFor('2026-02', 31)).toBe('2026-02-28')
    expect(chargeDateFor('2026-09', 5)).toBe('2026-09-05')
  })
})

describe('amountForMonth', () => {
  const schedule = [
    entry({ id: 'sep', amountCents: 55_000, effectiveFrom: '2026-09' }),
    entry({ id: 'dic', amountCents: 61_000, effectiveFrom: '2026-12' })
  ]

  it('usa el tramo de mayor effectiveFrom que no supere el mes', () => {
    expect(amountForMonth(schedule, '2026-09')?.id).toBe('sep')
    expect(amountForMonth(schedule, '2026-11')?.id).toBe('sep')
    expect(amountForMonth(schedule, '2026-12')?.id).toBe('dic')
    expect(amountForMonth(schedule, '2027-06')?.id).toBe('dic')
  })

  it('devuelve null antes del primer tramo', () => {
    expect(amountForMonth(schedule, '2026-08')).toBeNull()
  })
})

describe('mortgageMonthRange', () => {
  it('va del primer tramo al mes de hoy, sin meses futuros', () => {
    const schedule = [entry({ effectiveFrom: '2026-09' })]
    expect(mortgageMonthRange(schedule, '2026-11-20')).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('respeta un from explícito y devuelve [] sin tramos', () => {
    const schedule = [entry({ effectiveFrom: '2026-09' })]
    expect(mortgageMonthRange(schedule, '2026-11-20', '2026-10')).toEqual(['2026-10', '2026-11'])
    expect(mortgageMonthRange([], '2026-11-20')).toEqual([])
  })
})

describe('planMortgageCharges', () => {
  const schedule = [entry({ amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })]

  it('crea los meses que faltan, con el importe y la fecha del tramo', () => {
    const plan = planMortgageCharges({
      schedule,
      today: '2026-11-10',
      existing: [{ month: '2026-09', deleted: false }]
    })

    expect(plan.toCreate.map(c => c.month)).toEqual(['2026-10', '2026-11'])
    expect(plan.toCreate[0]).toMatchObject({ date: '2026-10-05', amountCents: 55_000 })
  })

  it('un cargo en la papelera deja el mes ocupado: no se recrea, se ofrece restaurar', () => {
    const plan = planMortgageCharges({
      schedule,
      today: '2026-11-10',
      existing: [
        { month: '2026-09', deleted: true },
        { month: '2026-10', deleted: false }
      ]
    })

    expect(plan.toCreate.map(c => c.month)).toEqual(['2026-11'])
    expect(plan.toRestore).toEqual(['2026-09'])
  })

  it('el cron espera al día de cargo del mes en curso', () => {
    const pending = planMortgageCharges({
      schedule,
      today: '2026-11-03',
      existing: [],
      requireDayPassed: true
    })
    expect(pending.toCreate.map(c => c.month)).toEqual(['2026-09', '2026-10'])
    expect(pending.pendingDay).toEqual(['2026-11'])

    const due = planMortgageCharges({
      schedule,
      today: '2026-11-05',
      existing: [],
      requireDayPassed: true
    })
    expect(due.toCreate.map(c => c.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(due.pendingDay).toEqual([])
  })

  it('cambiar el importe desde diciembre no reescribe los meses anteriores', () => {
    const plan = planMortgageCharges({
      schedule: [entry({ amountCents: 55_000, effectiveFrom: '2026-09' }), entry({ amountCents: 61_000, effectiveFrom: '2026-12' })],
      today: '2026-12-31',
      existing: []
    })
    expect(plan.toCreate.map(c => [c.month, c.amountCents])).toEqual([
      ['2026-09', 55_000],
      ['2026-10', 55_000],
      ['2026-11', 55_000],
      ['2026-12', 61_000]
    ])
  })
})

describe('findManualCandidates', () => {
  const schedule = [entry({ amountCents: 55_000, effectiveFrom: '2026-09' })]

  it('propone salidas del mes con el importe del tramo o con «hipoteca» en la descripción', () => {
    const candidates = findManualCandidates([
      candidate({ id: 'importe-ok', date: '2026-09-03', amountCents: 55_000 }),
      candidate({ id: 'por-descripcion', date: '2026-10-03', amountCents: 50_000, description: 'CUOTA HIPOTECA BBVA' }),
      candidate({ id: 'no-candidato', date: '2026-10-20', amountCents: 12_000, description: 'Luz' })
    ], schedule, '2026-11-10')

    expect(candidates.map(c => c.id)).toEqual(['importe-ok', 'por-descripcion'])
    expect(candidates[0]!.amountMatches).toBe(true)
    expect(candidates[1]!.amountMatches).toBe(false)
  })

  it('excluye ingresos, filas en la papelera, cargos ya marcados y meses fuera del rango', () => {
    const candidates = findManualCandidates([
      candidate({ id: 'ingreso', direction: 'deposit', date: '2026-09-03' }),
      candidate({ id: 'papelera', date: '2026-09-03', deletedAt: new Date() }),
      candidate({ id: 'ya-marcado', date: '2026-09-03', mortgagePeriod: '2026-09' }),
      candidate({ id: 'futuro', date: '2027-05-03' }),
      candidate({ id: 'antes', date: '2026-08-03' })
    ], schedule, '2026-11-10')

    expect(candidates).toEqual([])
  })
})
