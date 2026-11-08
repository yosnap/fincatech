// Cálculos puros de la hipoteca (fase 7): importe vigente por tramo, fecha de cargo recortada
// a fin de mes, meses pendientes de rellenar y detección de pagos manuales que el admin puede
// adoptar como cargo automático. Sin acceso a DB — el servicio vive en mortgage-service.ts.

import { isValidPeriod, monthRange } from './bank-core'

// Primer mes con hipoteca configurable: en agosto de 2026 el préstamo aún no estaba (decisión
// del usuario). También actúa como suelo del rango de relleno.
export const MIN_MORTGAGE_MONTH = '2026-09'

export interface MortgageScheduleEntry {
  id: string
  amountCents: number
  // 1-31: día de cargo dentro del mes.
  chargeDay: number
  // 'YYYY-MM' desde el que aplica este importe y día.
  effectiveFrom: string
}

// 'YYYY-MM-DD' de hoy en la zona horaria de la finca. `now` inyectable para poder testear el
// cron sin depender del reloj real (mismo criterio que currentPeriodNow en bank-core).
export function todayInMadrid(now: Date = new Date()): string {
  // en-CA produce directamente 'YYYY-MM-DD'.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
}

export function lastDayOfMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  // Día 0 del mes siguiente = último día del mes pedido (UTC: sin saltos de horario).
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
}

// Fecha real del cargo: si el día configurado no existe en ese mes (31 en febrero), se usa el
// último día del mes — es lo que hace el banco.
export function chargeDateFor(month: string, chargeDay: number): string {
  const day = Math.min(Math.max(chargeDay, 1), lastDayOfMonth(month))
  return `${month}-${String(day).padStart(2, '0')}`
}

// Tramo vigente para un mes: el de mayor `effectiveFrom` que no sea posterior al mes.
// null si el mes es anterior al primer tramo configurado.
export function amountForMonth(schedule: MortgageScheduleEntry[], month: string): MortgageScheduleEntry | null {
  let winner: MortgageScheduleEntry | null = null
  for (const entry of schedule) {
    if (entry.effectiveFrom > month) continue
    if (!winner || entry.effectiveFrom > winner.effectiveFrom) winner = entry
  }
  return winner
}

// Rango de meses con hipoteca: desde el primer tramo (o `from`) hasta el mes de hoy. No se
// generan meses futuros.
export function mortgageMonthRange(schedule: MortgageScheduleEntry[], today: string, from?: string | null): string[] {
  const first = schedule.reduce<string | null>(
    (min, entry) => (min === null || entry.effectiveFrom < min ? entry.effectiveFrom : min),
    null
  )
  const start = from ?? first
  if (!start || !isValidPeriod(start)) return []
  return monthRange(start, today.slice(0, 7))
}

export interface ExistingMortgageMonth {
  month: string
  // El cargo del mes existe pero está en la papelera: el mes cuenta como OCUPADO (RT8-10).
  deleted: boolean
}

export interface PlannedMortgageCharge {
  month: string
  date: string
  amountCents: number
  scheduleId: string
}

export interface MortgagePlan {
  // Meses sin cargo: se crean.
  toCreate: PlannedMortgageCharge[]
  // Meses cuyo cargo está en la papelera: NO se recrea, se ofrece restaurarlo.
  toRestore: string[]
  // Meses en rango cuyo día de cargo aún no ha llegado (solo los filtra el cron).
  pendingDay: string[]
}

// Planificador único del relleno y del cron. El relleno manual (requireDayPassed = false) crea
// todos los meses vencidos que falten; el cron (requireDayPassed = true) espera a que llegue el
// día de cargo del mes en curso.
export function planMortgageCharges(input: {
  schedule: MortgageScheduleEntry[]
  today: string
  existing: ExistingMortgageMonth[]
  from?: string | null
  requireDayPassed?: boolean
}): MortgagePlan {
  const plan: MortgagePlan = { toCreate: [], toRestore: [], pendingDay: [] }
  const existingByMonth = new Map(input.existing.map(row => [row.month, row]))

  for (const month of mortgageMonthRange(input.schedule, input.today, input.from)) {
    const entry = amountForMonth(input.schedule, month)
    if (!entry) continue

    const date = chargeDateFor(month, entry.chargeDay)
    if (input.requireDayPassed && date > input.today) {
      plan.pendingDay.push(month)
      continue
    }

    const existing = existingByMonth.get(month)
    if (existing) {
      if (existing.deleted) plan.toRestore.push(month)
      continue
    }

    plan.toCreate.push({ month, date, amountCents: entry.amountCents, scheduleId: entry.id })
  }

  return plan
}

export interface MortgageCandidateInput {
  id: string
  date: string
  direction: string
  amountCents: number
  description: string
  mortgagePeriod: string | null
  deletedAt: Date | null
}

export interface MortgageManualCandidate {
  id: string
  month: string
  date: string
  amountCents: number
  description: string
  // false = se propone por la descripción («hipoteca»), no por coincidir el importe.
  amountMatches: boolean
}

// Pagos manuales que pueden ser el cargo de la hipoteca de un mes: salidas sin marcar, de un
// mes con tramo vigente, cuyo importe coincide con el del tramo o cuya descripción menciona la
// hipoteca. Se ofrecen para ADOPTAR (no se borra nada): adoptar asigna el `mortgagePeriod` del
// mes y conserva el justificante.
export function findManualCandidates(
  transactions: MortgageCandidateInput[],
  schedule: MortgageScheduleEntry[],
  today: string
): MortgageManualCandidate[] {
  const months = new Set(mortgageMonthRange(schedule, today))
  const candidates: MortgageManualCandidate[] = []

  for (const transaction of transactions) {
    if (transaction.direction !== 'withdrawal') continue
    if (transaction.mortgagePeriod !== null) continue
    if (transaction.deletedAt !== null) continue

    const month = transaction.date.slice(0, 7)
    if (!months.has(month)) continue

    const entry = amountForMonth(schedule, month)
    if (!entry) continue

    const amountMatches = transaction.amountCents === entry.amountCents
    const mentionsMortgage = /hipoteca/i.test(transaction.description)
    if (!amountMatches && !mentionsMortgage) continue

    candidates.push({
      id: transaction.id,
      month,
      date: transaction.date,
      amountCents: transaction.amountCents,
      description: transaction.description,
      amountMatches
    })
  }

  return candidates.sort((a, b) => a.date.localeCompare(b.date))
}

// Descripción del cargo automático: mismo formato para todos los meses, para que se reconozca
// de un vistazo en la lista de movimientos.
export function mortgageDescription(month: string): string {
  return `Hipoteca ${month}`
}
