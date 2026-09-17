// Cálculos puros de la cuenta bancaria y las contribuciones (sin acceso a DB — los wrappers
// con consultas viven en bank-service.ts y contribution-service.ts). Todo en céntimos
// enteros, mismo criterio que el resto del dominio financiero (ver settlement-core.ts).

export type BankTransactionDirection = 'deposit' | 'withdrawal'

export interface BankTransactionCore {
  id: string
  // 'YYYY-MM-DD' (columna date de Drizzle en modo string) — comparable lexicográficamente.
  date: string
  direction: string
  amountCents: number
  description: string
  // Solo depósitos externos: 'hacienda' | 'ayuntamiento' | 'impuestos' | 'iva' | 'otro'.
  category: string | null
  createdAt: Date
}

export interface ContributionCore {
  id: string
  memberId: string
  amountCents: number
  // 'pre_purchase' | 'quota' | 'extraordinary'
  type: string
  // 'YYYY-MM'; null para pre_purchase y extraordinary
  period: string | null
  // 'cash' | 'transfer'
  method: string
  // Fecha del aporte (cuándo el miembro entregó el dinero).
  date: string
  bankTransactionId: string | null
}

export interface MemberCore {
  id: string
  name: string
}

// Orden estable de los movimientos: fecha valor asc, desempate por createdAt e id. Sin este
// desempate, dos movimientos del mismo día podrían intercambiar su saldo acumulado entre
// recargas y la columna "saldo" bailaría visualmente.
function byStableOrder(a: BankTransactionCore, b: BankTransactionCore): number {
  return a.date.localeCompare(b.date)
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.id.localeCompare(b.id)
}

function signedAmount(t: Pick<BankTransactionCore, 'direction' | 'amountCents'>): number {
  return t.direction === 'deposit' ? t.amountCents : -t.amountCents
}

// Intersección (no interface extends T): TS no garantiza que un subtipo de
// BankTransactionCore sea asignable a una interfaz que lo extiende.
export type TransactionWithBalance<T extends BankTransactionCore> = T & { balanceCentsAfter: number }

// Saldo acumulado por movimiento (columna "saldo" del listado): devuelve una copia ordenada
// con balanceCentsAfter añadido a cada fila. El saldo NUNCA se guarda en DB.
export function computeRunningBalance<T extends BankTransactionCore>(transactions: T[]): TransactionWithBalance<T>[] {
  const sorted = [...transactions].sort(byStableOrder)
  let balance = 0
  return sorted.map((t) => {
    balance += signedAmount(t)
    return { ...t, balanceCentsAfter: balance }
  })
}

export interface BankBalances {
  currentCents: number
  // Saldo justo antes de la compra del inmueble: movimientos con fecha < purchaseDate
  // (estricto). 0 si no hay fecha de compra configurada.
  prePurchaseCents: number
}

export function computeBalances(transactions: BankTransactionCore[], purchaseDate: string | null): BankBalances {
  const sum = (list: BankTransactionCore[]) => list.reduce((sum, t) => sum + signedAmount(t), 0)
  return {
    currentCents: sum(transactions),
    prePurchaseCents: purchaseDate ? sum(transactions.filter(t => t.date < purchaseDate)) : 0
  }
}

export interface ReconciliationResult {
  // Efectivo entregado al tesorero que aún no se ha depositado en el banco.
  cashPendingCents: number
  cashPending: ContributionCore[]
  // Ingresos bancarios sin aporte de miembro vinculado ni categoría externa: dinero que
  // entró y nadie ha explicado de dónde viene.
  unmatchedDeposits: BankTransactionCore[]
}

export function computeReconciliation(
  transactions: BankTransactionCore[],
  contributions: ContributionCore[]
): ReconciliationResult {
  const linkedTransactionIds = new Set(
    contributions.map(c => c.bankTransactionId).filter((id): id is string => id !== null)
  )
  const unmatchedDeposits = transactions.filter(t =>
    t.direction === 'deposit' && t.category === null && !linkedTransactionIds.has(t.id)
  )
  const cashPending = contributions.filter(c => c.method === 'cash' && c.bankTransactionId === null)
  return {
    cashPendingCents: cashPending.reduce((sum, c) => sum + c.amountCents, 0),
    cashPending,
    unmatchedDeposits
  }
}

export interface FondoComunMember {
  memberId: string
  name: string
  contributedCents: number
  // Parte de las salidas del fondo que corresponde a este miembro (partes iguales).
  withdrawalsShareCents: number
  // Saldo con el fondo común: aportado − parte de salidas. Los depósitos externos
  // (Hacienda, IVA…) NO se acreditan a nadie: quedan en el bote y benefician a todos
  // implícitamente, por eso Σ saldos_i = fondo total − ingresos externos.
  balanceCents: number
}

// Fórmula del fondo común: saldo_i = Σ contribuciones_i − (Σ salidas / N), con N = miembros
// activos actuales (decisión de producto: sin histórico de altas/bajas). La división entera
// deja un resto de céntimos que se reparte uno a uno por orden alfabético de id —
// determinista y con Σ partes = Σ salidas exacto.
export function computeFondoComun(
  contributions: ContributionCore[],
  transactions: BankTransactionCore[],
  activeMembers: MemberCore[]
): FondoComunMember[] {
  const totalWithdrawalsCents = transactions
    .filter(t => t.direction === 'withdrawal')
    .reduce((sum, t) => sum + t.amountCents, 0)

  const contributedBy = new Map<string, number>()
  for (const c of contributions) {
    contributedBy.set(c.memberId, (contributedBy.get(c.memberId) ?? 0) + c.amountCents)
  }

  const sortedMembers = [...activeMembers].sort((a, b) => a.id.localeCompare(b.id))
  const n = sortedMembers.length
  const baseShare = n > 0 ? Math.floor(totalWithdrawalsCents / n) : 0
  const remainder = n > 0 ? totalWithdrawalsCents - baseShare * n : 0

  return sortedMembers.map((member, index) => {
    const contributedCents = contributedBy.get(member.id) ?? 0
    const withdrawalsShareCents = baseShare + (index < remainder ? 1 : 0)
    return {
      memberId: member.id,
      name: member.name,
      contributedCents,
      withdrawalsShareCents,
      balanceCents: contributedCents - withdrawalsShareCents
    }
  })
}

// ---- Utilidades de períodos ('YYYY-MM') para cuotas y adelanto multi-mes ----

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 'YYYY-MM-DD' con fecha de calendario REAL: el regex alone deja pasar '2026-02-31',
// que Postgres rechaza al insertar → 500. El round-trip por Date lo valida.
export function isValidCalendarDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

// '2026-11' + 3 → '2027-02'. Asume períodos ya validados (isValidPeriod).
export function addMonths(period: string, count: number): string {
  const [year, month] = period.split('-').map(Number)
  const total = year! * 12 + (month! - 1) + count
  const newYear = Math.floor(total / 12)
  const newMonth = (total % 12) + 1
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`
}

// Rango inclusive de meses: monthRange('2026-08', '2026-10') → ['2026-08','2026-09','2026-10'].
// Devuelve [] si start > end o si falta alguno (sin quotaStartMonth configurado no hay grid).
export function monthRange(start: string | null, end: string | null): string[] {
  if (!start || !end || !isValidPeriod(start) || !isValidPeriod(end)) return []
  if (start > end) return []
  const months: string[] = []
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) months.push(cursor)
  return months
}

// Períodos que cubre un pago de cuota: 1 fila por mes consecutivo desde `period`.
// El adelanto multi-mes (validación sesión 1) crea N filas, una por mes.
export function expandQuotaPeriods(period: string, months: number): string[] {
  return Array.from({ length: months }, (_, i) => addMonths(period, i))
}

// Descripción del ingreso bancario auto-creado para un aporte por transferencia.
export function buildTransferDescription(
  type: string,
  periods: string[],
  memberName: string
): string {
  if (type === 'quota' && periods.length > 0) {
    return periods.length === 1
      ? `Cuota ${periods[0]} — ${memberName}`
      : `Cuotas ${periods[0]} a ${periods[periods.length - 1]} — ${memberName}`
  }
  if (type === 'pre_purchase') return `Aporte pre-compra — ${memberName}`
  return `Aporte extraordinario — ${memberName}`
}

// ---- Grid mensual de cuotas ----

export interface QuotaCell {
  memberId: string
  // null → pendiente; fila de cuota existente → pagado (o adelantado si el mes es futuro).
  contribution: ContributionCore | null
}

export interface QuotaMonth {
  period: string
  // Mes posterior al actual: solo puede aparecer pagado por adelanto multi-mes.
  isFuture: boolean
  cells: QuotaCell[]
}

// Grid miembro×mes desde quotaStartMonth hasta `currentPeriod` inclusive (los meses futuros
// no existen en el rango: solo se muestran pagados por adelanto cuando ya hay fila). Las
// columnas extra de adelanto (meses > currentPeriod con cuota registrada) se añaden al final.
export function buildQuotaGrid(
  activeMembers: MemberCore[],
  quotaContributions: ContributionCore[],
  quotaStartMonth: string | null,
  currentPeriod: string
): QuotaMonth[] {
  const byMemberPeriod = new Map<string, ContributionCore>()
  for (const c of quotaContributions) {
    if (c.period) byMemberPeriod.set(`${c.memberId}|${c.period}`, c)
  }

  // Meses del rango base + meses adelantados que quedan fuera del rango.
  const baseMonths = monthRange(quotaStartMonth, currentPeriod)
  const advancedMonths = [...new Set(
    quotaContributions
      .map(c => c.period)
      .filter((p): p is string => p !== null && p > currentPeriod)
  )].sort()
  const allMonths = [...baseMonths, ...advancedMonths.filter(p => !baseMonths.includes(p))]

  return allMonths.map(period => ({
    period,
    isFuture: period > currentPeriod,
    cells: activeMembers.map(member => ({
      memberId: member.id,
      contribution: byMemberPeriod.get(`${member.id}|${period}`) ?? null
    }))
  }))
}

// Período ('YYYY-MM') del mes en curso para delimitar el grid.
export function currentPeriodNow(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
