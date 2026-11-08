import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { bankTransactions, financeSettings, mortgageSchedule } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'
import { notDeleted } from '../utils/soft-delete'
import { addMonths, isValidPeriod } from './bank-core'
import {
  findManualCandidates,
  MIN_MORTGAGE_MONTH,
  mortgageDescription,
  planMortgageCharges,
  todayInMadrid,
  type ExistingMortgageMonth,
  type MortgageManualCandidate,
  type PlannedMortgageCharge
} from './mortgage-core'

const GLOBAL_SETTINGS_ID = 'global'

export interface MortgageScheduleRow {
  id: string
  amountCents: number
  chargeDay: number
  effectiveFrom: string
  createdBy: string
  createdAt: Date
}

export interface MortgageChargeRow {
  id: string
  month: string
  date: string
  amountCents: number
  deletedAt: Date | null
}

export interface MortgageOverview {
  schedule: MortgageScheduleRow[]
  // Marca de agua: el cron solo genera meses posteriores.
  generatedThrough: string | null
  // Cargos automáticos existentes (incluidos los que están en la papelera: el mes cuenta como
  // ocupado hasta que se restaure o se elimine definitivamente).
  charges: MortgageChargeRow[]
}

function assertValidEntry(input: { amountCents: number, chargeDay: number, effectiveFrom: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'El importe del cargo debe ser mayor que cero' })
  }
  if (!Number.isInteger(input.chargeDay) || input.chargeDay < 1 || input.chargeDay > 31) {
    throw createError({ statusCode: 400, statusMessage: 'El día de cargo debe estar entre 1 y 31' })
  }
  if (!isValidPeriod(input.effectiveFrom)) {
    throw createError({ statusCode: 400, statusMessage: 'El mes de inicio debe tener formato YYYY-MM' })
  }
  // En agosto de 2026 aún no había hipoteca (decisión del usuario): un tramo anterior dejaría
  // cargos que nunca existieron.
  if (input.effectiveFrom < MIN_MORTGAGE_MONTH) {
    throw createError({ statusCode: 400, statusMessage: `El primer mes de hipoteca no puede ser anterior a ${MIN_MORTGAGE_MONTH}` })
  }
}

async function listScheduleRows(tx: TxExecutor = db): Promise<MortgageScheduleRow[]> {
  return tx.select().from(mortgageSchedule).orderBy(asc(mortgageSchedule.effectiveFrom))
}

async function listCargoRows(tx: TxExecutor = db): Promise<MortgageChargeRow[]> {
  const rows = await tx.select({
    id: bankTransactions.id,
    month: bankTransactions.mortgagePeriod,
    date: bankTransactions.date,
    amountCents: bankTransactions.amountCents,
    deletedAt: bankTransactions.deletedAt
  }).from(bankTransactions).where(isNotNull(bankTransactions.mortgagePeriod))

  return rows
    .filter((row): row is MortgageChargeRow & { month: string } => row.month !== null)
    .sort((a, b) => a.month.localeCompare(b.month))
}

async function getWatermark(tx: TxExecutor = db): Promise<string | null> {
  const [row] = await tx.select({ generatedThrough: financeSettings.mortgageGeneratedThrough })
    .from(financeSettings)
    .where(eq(financeSettings.id, GLOBAL_SETTINGS_ID))
  return row?.generatedThrough ?? null
}

// Upsert que solo toca esta columna: guardar la configuración financiera desde
// /api/bank/settings no debe pisar la marca de agua ni al revés.
async function setWatermark(tx: TxExecutor, month: string) {
  await tx.insert(financeSettings)
    .values({ id: GLOBAL_SETTINGS_ID, mortgageGeneratedThrough: month, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: financeSettings.id,
      set: { mortgageGeneratedThrough: month, updatedAt: new Date() }
    })
}

export async function getMortgageOverview(): Promise<MortgageOverview> {
  const [schedule, charges, generatedThrough] = await Promise.all([
    listScheduleRows(),
    listCargoRows(),
    getWatermark()
  ])
  return { schedule, charges, generatedThrough }
}

interface ScheduleEntryInput {
  actorId: string
  amountCents: number
  chargeDay: number
  effectiveFrom: string
}

// Los tramos no tocan cargos ya creados (RT-10): cambiar el importe desde diciembre no
// reescribe septiembre a noviembre, y borrar un tramo no elimina movimientos.
export async function createScheduleEntry(input: ScheduleEntryInput) {
  assertValidEntry(input)
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(mortgageSchedule).values({
      amountCents: input.amountCents,
      chargeDay: input.chargeDay,
      effectiveFrom: input.effectiveFrom,
      createdBy: input.actorId
    }).returning().catch((error: unknown) => {
      if (getPgErrorCode(error) === '23505') {
        throw createError({ statusCode: 409, statusMessage: 'Ya hay un tramo configurado que empieza ese mes' })
      }
      throw error
    })
    if (!entry) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo guardar el tramo' })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'mortgage_schedule_created',
      entityType: 'mortgage_schedule',
      entityId: entry.id,
      metadata: { amountCents: entry.amountCents, chargeDay: entry.chargeDay, effectiveFrom: entry.effectiveFrom }
    }, tx)

    return entry
  })
}

interface UpdateScheduleEntryInput extends ScheduleEntryInput {
  entryId: string
}

export async function updateScheduleEntry(input: UpdateScheduleEntryInput) {
  assertValidEntry(input)
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(mortgageSchedule)
      .where(eq(mortgageSchedule.id, input.entryId)).for('update')
    if (!entry) {
      throw createError({ statusCode: 404, statusMessage: 'Tramo de hipoteca no encontrado' })
    }

    const [updated] = await tx.update(mortgageSchedule)
      .set({ amountCents: input.amountCents, chargeDay: input.chargeDay, effectiveFrom: input.effectiveFrom })
      .where(eq(mortgageSchedule.id, entry.id))
      .returning()
      .catch((error: unknown) => {
        if (getPgErrorCode(error) === '23505') {
          throw createError({ statusCode: 409, statusMessage: 'Ya hay otro tramo configurado que empieza ese mes' })
        }
        throw error
      })

    await writeAuditLog({
      actorId: input.actorId,
      action: 'mortgage_schedule_updated',
      entityType: 'mortgage_schedule',
      entityId: entry.id,
      metadata: {
        before: { amountCents: entry.amountCents, chargeDay: entry.chargeDay, effectiveFrom: entry.effectiveFrom },
        after: { amountCents: input.amountCents, chargeDay: input.chargeDay, effectiveFrom: input.effectiveFrom }
      }
    }, tx)

    return updated!
  })
}

export async function deleteScheduleEntry(input: { entryId: string, actorId: string }) {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(mortgageSchedule)
      .where(eq(mortgageSchedule.id, input.entryId)).for('update')
    if (!entry) {
      throw createError({ statusCode: 404, statusMessage: 'Tramo de hipoteca no encontrado' })
    }

    await tx.delete(mortgageSchedule).where(eq(mortgageSchedule.id, entry.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'mortgage_schedule_deleted',
      entityType: 'mortgage_schedule',
      entityId: entry.id,
      metadata: { amountCents: entry.amountCents, chargeDay: entry.chargeDay, effectiveFrom: entry.effectiveFrom }
    }, tx)

    return { entryId: entry.id }
  })
}

export interface MortgageBackfillPreview {
  toCreate: PlannedMortgageCharge[]
  // Meses cuyo cargo está en la papelera: se restauran desde /admin/trash, no se recrean.
  toRestore: string[]
  // Pagos manuales adoptables (solo de meses que aún no tienen cargo).
  candidates: MortgageManualCandidate[]
}

export async function previewBackfill(now: Date = new Date()): Promise<MortgageBackfillPreview> {
  const today = todayInMadrid(now)
  const [schedule, charges, transactions] = await Promise.all([
    listScheduleRows(),
    listCargoRows(),
    db.select().from(bankTransactions)
  ])

  const existing: ExistingMortgageMonth[] = charges.map(charge => ({
    month: charge.month,
    deleted: charge.deletedAt !== null
  }))
  const plan = planMortgageCharges({ schedule, today, existing })
  const missingMonths = new Set(plan.toCreate.map(charge => charge.month))
  const candidates = findManualCandidates(transactions, schedule, today)
    .filter(candidate => missingMonths.has(candidate.month))

  return { toCreate: plan.toCreate, toRestore: plan.toRestore, candidates }
}

interface ConfirmBackfillInput {
  actorId: string
  // Pagos manuales que el admin adopta como cargo automático de su mes (conservan justificante).
  adoptTransactionIds?: string[]
  now?: Date
}

interface BackfillResult {
  created: PlannedMortgageCharge[]
  adopted: Array<{ transactionId: string, month: string }>
}

// Relleno explícito del admin: en UNA transacción adopta los pagos manuales elegidos y crea los
// meses que siguen sin cargo. Solo crea meses que faltan; nunca modifica un cargo existente
// (RT-10). Un mes con cargo en la papelera no se recrea: se avisa para restaurarlo.
export async function confirmBackfill(input: ConfirmBackfillInput): Promise<BackfillResult & { toRestore: string[] }> {
  const today = todayInMadrid(input.now ?? new Date())

  return db.transaction(async (tx) => {
    // Advisory lock: el cron y un relleno manual no pueden crear el mismo mes a la vez.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fincatech:mortgage:generation'))`)

    const schedule = await listScheduleRows(tx)
    if (schedule.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Configura primero el importe y el día de cargo de la hipoteca' })
    }
    const charges = await listCargoRows(tx)
    const transactions = await tx.select().from(bankTransactions)

    const plan = planMortgageCharges({
      schedule,
      today,
      existing: charges.map(charge => ({ month: charge.month, deleted: charge.deletedAt !== null }))
    })
    const missingMonths = new Set(plan.toCreate.map(charge => charge.month))

    // Solo se pueden adoptar pagos candidatos de un mes que siga sin cargo: el resto de ids se
    // rechaza en bloque (no se ignora en silencio).
    const allowed = new Map(
      findManualCandidates(transactions, schedule, today)
        .filter(candidate => missingMonths.has(candidate.month))
        .map(candidate => [candidate.id, candidate.month])
    )
    const requested = input.adoptTransactionIds ?? []
    const invalid = requested.filter(id => !allowed.has(id))
    if (invalid.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Alguno de los pagos seleccionados ya no es un candidato válido (revisa la vista previa)',
        data: { invalidIds: invalid }
      })
    }

    const adopted: Array<{ transactionId: string, month: string }> = []
    for (const transactionId of requested) {
      const month = allowed.get(transactionId)!
      const [updated] = await tx.update(bankTransactions)
        .set({ mortgagePeriod: month })
        .where(and(eq(bankTransactions.id, transactionId), sql`${bankTransactions.mortgagePeriod} is null`))
        .returning()
      if (!updated) {
        throw createError({ statusCode: 409, statusMessage: 'El pago cambió mientras se adoptaba: vuelve a previsualizar' })
      }
      adopted.push({ transactionId, month })
      await writeAuditLog({
        actorId: input.actorId,
        action: 'mortgage_manual_adopted',
        entityType: 'bank_transaction',
        entityId: transactionId,
        metadata: { month, amountCents: updated.amountCents, description: updated.description }
      }, tx)
    }

    const adoptedMonths = new Set(adopted.map(row => row.month))
    const created: PlannedMortgageCharge[] = []
    for (const charge of plan.toCreate) {
      if (adoptedMonths.has(charge.month)) continue
      const entry = schedule.find(row => row.id === charge.scheduleId)
      const [inserted] = await tx.insert(bankTransactions).values({
        date: charge.date,
        direction: 'withdrawal',
        amountCents: charge.amountCents,
        description: mortgageDescription(charge.month),
        category: null,
        hasProof: false,
        registeredBy: entry?.createdBy ?? input.actorId,
        mortgagePeriod: charge.month
      }).onConflictDoNothing().returning()
      // Conflicto = otro proceso lo creó mientras tanto: el mes ya tiene cargo, no es un error.
      if (!inserted) continue
      created.push(charge)
      await writeAuditLog({
        actorId: input.actorId,
        action: 'mortgage_charge_generated',
        entityType: 'bank_transaction',
        entityId: inserted.id,
        metadata: { channel: 'web', month: charge.month, amountCents: charge.amountCents, date: charge.date }
      }, tx)
    }

    // La marca avanza al mes en curso: un cargo borrado a mano no reaparece al día siguiente.
    await setWatermark(tx, today.slice(0, 7))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'mortgage_backfill_confirmed',
      entityType: 'finance_settings',
      entityId: GLOBAL_SETTINGS_ID,
      metadata: { created: created.map(c => c.month), adopted: adopted.map(a => a.month), toRestore: plan.toRestore }
    }, tx)

    return { created, adopted, toRestore: plan.toRestore }
  })
}

// Núcleo del cron: crea el cargo del mes cuando llega su día y avanza la marca de agua.
// Idempotente (índice único de `mortgage_period` + marca de agua): reiniciar el servidor o
// ejecutar dos veces el mismo día no duplica nada.
export async function generateDueCharges(now: Date = new Date()): Promise<{ created: string[] }> {
  const today = todayInMadrid(now)

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fincatech:mortgage:generation'))`)

    const schedule = await listScheduleRows(tx)
    if (schedule.length === 0) return { created: [] }

    const watermark = await getWatermark(tx)
    const charges = await listCargoRows(tx)
    const plan = planMortgageCharges({
      schedule,
      today,
      existing: charges.map(charge => ({ month: charge.month, deleted: charge.deletedAt !== null })),
      // Solo meses posteriores a la marca: si el admin borró el cargo de un mes, no reaparece.
      from: watermark ? addMonths(watermark, 1) : null,
      requireDayPassed: true
    })

    const created: string[] = []
    for (const charge of plan.toCreate) {
      const entry = schedule.find(row => row.id === charge.scheduleId)
      const [inserted] = await tx.insert(bankTransactions).values({
        date: charge.date,
        direction: 'withdrawal',
        amountCents: charge.amountCents,
        description: mortgageDescription(charge.month),
        category: null,
        hasProof: false,
        registeredBy: entry?.createdBy ?? schedule[0]!.createdBy,
        mortgagePeriod: charge.month
      }).onConflictDoNothing().returning()
      if (!inserted) continue
      created.push(charge.month)
      await writeAuditLog({
        actorId: entry?.createdBy ?? null,
        action: 'mortgage_charge_generated',
        entityType: 'bank_transaction',
        entityId: inserted.id,
        metadata: { channel: 'system', month: charge.month, amountCents: charge.amountCents, date: charge.date }
      }, tx)
    }

    // La marca no puede adelantar al mes cuyo día de cargo aún no ha llegado.
    const lastSettledMonth = plan.pendingDay.length > 0
      ? addMonths(plan.pendingDay[0]!, -1)
      : today.slice(0, 7)
    if (!watermark || lastSettledMonth > watermark) {
      await setWatermark(tx, lastSettledMonth)
    }

    return { created }
  })
}

// Restaurar un cargo automático cuyo mes ya tiene otro cargo vivo → 409 (RT8-10). Se comprueba
// desde bank-service al restaurar, aquí solo el helper para no duplicar la consulta.
export async function assertNoOtherChargeForMonth(month: string, transactionId: string) {
  const [other] = await db.select({ id: bankTransactions.id }).from(bankTransactions)
    .where(and(
      eq(bankTransactions.mortgagePeriod, month),
      notDeleted(bankTransactions),
      sql`${bankTransactions.id} <> ${transactionId}`
    ))
    .limit(1)
  if (other) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ya hay otro cargo de hipoteca vivo para ese mes: elimínalo definitivamente antes de restaurar este'
    })
  }
}
