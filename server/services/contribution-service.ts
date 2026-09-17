import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { bankTransactions, contributions, paymentProofs, users } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'
import {
  buildQuotaGrid,
  buildTransferDescription,
  currentPeriodNow,
  expandQuotaPeriods,
  isValidPeriod
} from './bank-core'
import { getActiveMembers, getSettings, type ActiveMember, type FinanceSettings } from './bank-service'

export const CONTRIBUTION_TYPES = ['pre_purchase', 'quota', 'extraordinary'] as const
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]

export const CONTRIBUTION_METHODS = ['cash', 'transfer'] as const
export type ContributionMethod = (typeof CONTRIBUTION_METHODS)[number]

interface CreateContributionInput {
  actorId: string
  actorRole: string
  memberId: string
  // Para quota: importe de UNA cuota (cada mes genera su fila con este importe). Para el
  // resto: importe único del aporte.
  amountCents: number
  type: ContributionType
  // 'YYYY-MM'; obligatorio para quota, prohibido para el resto.
  period: string | null
  method: ContributionMethod
  date: string
  // Solo quota: adelanto multi-mes (1-N filas consecutivas en una transacción).
  months?: number
  notes?: string | null
  // Solo transfer: justificante del ticket bancario, adjunto al MOVIMIENTO auto-creado.
  proof?: { objectName: string, contentType: string }
}

// TX: aportes + movimiento auto-creado + proof + audit en una sola transacción. Si algo
// falla a mitad (p. ej. duplicado miembro-mes en un adelanto) no queda fila huérfana ni
// movimiento sin cuota.
export async function createContribution(input: CreateContributionInput) {
  // Opción B (validación sesión 1): el admin puede registrar por otro miembro; el resto
  // solo registra lo suyo. registeredBy siempre = usuario de sesión.
  if (input.memberId !== input.actorId && input.actorRole !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Solo puedes registrar tus propios aportes' })
  }

  const months = input.type === 'quota' ? (input.months ?? 1) : 1
  if (input.type === 'quota') {
    if (!input.period || !isValidPeriod(input.period)) {
      throw createError({ statusCode: 400, statusMessage: 'La cuota requiere un período válido (YYYY-MM)' })
    }
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      throw createError({ statusCode: 400, statusMessage: 'Los meses de adelanto deben estar entre 1 y 24' })
    }
  } else if (input.period) {
    throw createError({ statusCode: 400, statusMessage: 'Solo las cuotas mensuales llevan período' })
  }

  // El miembro del aporte debe existir y estar activo (admin/owner no dado de baja).
  const [member] = await db.select({ id: users.id, name: users.name, banned: users.banned, role: users.role })
    .from(users)
    .where(eq(users.id, input.memberId))
  if (!member || member.banned || (member.role !== 'admin' && member.role !== 'owner')) {
    throw createError({ statusCode: 400, statusMessage: 'Miembro inválido: debe ser un miembro activo' })
  }

  const quotaPeriods = input.type === 'quota' ? expandQuotaPeriods(input.period!, months) : []
  const periods: (string | null)[] = input.type === 'quota' ? quotaPeriods : [null]

  return db.transaction(async (tx) => {
    // Transferencia = ingreso automático ya vinculado (validación sesión 1): el dinero fue
    // al banco directamente. Un único movimiento por el TOTAL del pago; las N filas de
    // cuota comparten el mismo bankTransactionId. El efectivo NO crea movimiento: queda
    // "pendiente de depósito" hasta vinculación manual.
    let bankTransactionId: string | null = null
    if (input.method === 'transfer') {
      const totalCents = input.amountCents * periods.length
      const description = buildTransferDescription(input.type, quotaPeriods, member.name)
      const [transaction] = await tx.insert(bankTransactions).values({
        date: input.date,
        direction: 'deposit',
        amountCents: totalCents,
        description,
        category: null,
        hasProof: !!input.proof,
        registeredBy: input.actorId
      }).returning()
      if (!transaction) {
        throw createError({ statusCode: 500, statusMessage: 'No se pudo crear el ingreso bancario' })
      }
      bankTransactionId = transaction.id
    }

    const rows = await tx.insert(contributions).values(
      periods.map(period => ({
        memberId: input.memberId,
        amountCents: input.amountCents,
        type: input.type,
        period,
        method: input.method,
        date: input.date,
        bankTransactionId,
        registeredBy: input.actorId,
        notes: input.notes ?? null
      }))
    ).returning().catch((error: unknown) => {
      // 23505 = unique_violation: el índice parcial contributions_quota_unique impide dos
      // cuotas del mismo miembro y mes (incluido el solapamiento entre adelantos).
      if (getPgErrorCode(error) === '23505') {
        throw createError({ statusCode: 409, statusMessage: 'Ese miembro ya tiene cuota registrada en uno de los meses seleccionados' })
      }
      throw error
    })

    // El justificante de una transferencia es el ticket bancario: va al MOVIMIENTO, no al
    // aporte (payment_proofs polimórfica, sin FK).
    if (input.proof && bankTransactionId) {
      await tx.insert(paymentProofs).values({
        objectName: input.proof.objectName,
        contentType: input.proof.contentType,
        uploadedBy: input.actorId,
        entityType: 'bank_transaction',
        entityId: bankTransactionId
      })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_created',
      entityType: 'contribution',
      entityId: rows[0]?.id ?? null,
      metadata: { memberId: input.memberId, type: input.type, period: input.period, months, method: input.method, amountCents: input.amountCents }
    }, tx)

    return { contributions: rows, bankTransactionId }
  })
}

interface LinkContributionInput {
  contributionId: string
  actorId: string
  bankTransactionId: string
}

// Vincula un aporte (efectivo en mano del tesorero) al ingreso bancario real: pasa de
// "pendiente de depósito" a "depositado". Se permite sobre cualquier aporte sin vínculo
// actual — en la práctica es el flujo del efectivo, pero también repara una transferencia
// cuyo movimiento fue borrado (el borrado la devuelve a pendiente).
export async function linkContribution(input: LinkContributionInput) {
  return db.transaction(async (tx) => {
    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (contribution.bankTransactionId) {
      throw createError({ statusCode: 409, statusMessage: 'El aporte ya está vinculado a un ingreso' })
    }

    const [transaction] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, input.bankTransactionId))
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Movimiento bancario no encontrado' })
    }
    if (transaction.direction !== 'deposit') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede vincular a un ingreso' })
    }
    // Un depósito categorizado como externo (Hacienda, IVA…) es por definición dinero que
    // no viene de un miembro: no puede ser el destino de un aporte.
    if (transaction.category) {
      throw createError({ statusCode: 400, statusMessage: 'Ese ingreso está marcado como externo y no puede vincularse a un aporte' })
    }
    // La fecha del depósito no puede ser anterior a la del aporte: el dinero existía en
    // manos del tesorero antes de llegar al banco.
    if (transaction.date < contribution.date) {
      throw createError({ statusCode: 400, statusMessage: 'El ingreso es anterior a la fecha del aporte' })
    }

    const [updated] = await tx.update(contributions)
      .set({ bankTransactionId: transaction.id, updatedAt: new Date() })
      .where(eq(contributions.id, contribution.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_linked',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: { bankTransactionId: transaction.id }
    }, tx)

    return updated
  })
}

interface UnlinkContributionInput {
  contributionId: string
  actorId: string
}

// Desvincular: el aporte vuelve a "pendiente de depósito" (el movimiento no se toca).
export async function unlinkContribution(input: UnlinkContributionInput) {
  return db.transaction(async (tx) => {
    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (!contribution.bankTransactionId) {
      throw createError({ statusCode: 409, statusMessage: 'El aporte no está vinculado' })
    }

    const [updated] = await tx.update(contributions)
      .set({ bankTransactionId: null, updatedAt: new Date() })
      .where(eq(contributions.id, contribution.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_unlinked',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: { previousBankTransactionId: contribution.bankTransactionId }
    }, tx)

    return updated
  })
}

interface UpdateContributionInput {
  contributionId: string
  actorId: string
  notes?: string | null
  date?: string
}

// Edición acotada (admin): notas y fecha del aporte. El importe, tipo, período y método no
// se editan — cambiarían el reparto del fondo común o el vínculo bancario; para corregirlos
// se borra y se registra de nuevo (mismo criterio conservador que updateExpenseParticipants).
export async function updateContribution(input: UpdateContributionInput) {
  return db.transaction(async (tx) => {
    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }

    // Invariante de conciliación: el depósito vinculado nunca puede ser anterior a la
    // fecha del aporte (el dinero existía en manos del tesorero antes del banco). Si la
    // edición mueve la fecha, se revalida contra el movimiento vinculado.
    if (input.date && contribution.bankTransactionId) {
      const [transaction] = await tx.select({ date: bankTransactions.date })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, contribution.bankTransactionId))
      if (transaction && transaction.date < input.date) {
        throw createError({ statusCode: 400, statusMessage: 'El ingreso vinculado es anterior a la nueva fecha del aporte' })
      }
    }

    const [updated] = await tx.update(contributions)
      .set({
        notes: input.notes !== undefined ? input.notes : contribution.notes,
        date: input.date ?? contribution.date,
        updatedAt: new Date()
      })
      .where(eq(contributions.id, contribution.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_updated',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: { date: input.date }
    }, tx)

    return updated
  })
}

interface DeleteContributionInput {
  contributionId: string
  actorId: string
  actorRole: string
}

// Borrado duro (autor del registro o admin — decisión de producto, patrón expenses). El
// movimiento bancario vinculado NUNCA se borra aquí, solo se desvincula: distinguir un
// ingreso auto-creado por transferencia de uno manual re-vinculado no es fiable, y borrar
// un registro manual legítimo sería pérdida de datos. Si el movimiento queda sin aporte
// origen, la alerta de "ingresos sin aporte asociado" del resumen lo destaca y el Admin lo
// elimina explícitamente.
export async function deleteContribution(input: DeleteContributionInput) {
  return db.transaction(async (tx) => {
    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (input.actorRole !== 'admin' && contribution.registeredBy !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo puedes eliminar los aportes que tú registraste' })
    }

    await tx.delete(contributions).where(eq(contributions.id, contribution.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_deleted',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: { memberId: contribution.memberId, type: contribution.type, period: contribution.period, amountCents: contribution.amountCents }
    }, tx)

    return { contributionId: contribution.id }
  })
}

export interface QuotaGrid {
  settings: FinanceSettings
  activeMembers: ActiveMember[]
  months: ReturnType<typeof buildQuotaGrid>
}

// Grid mensual de cuotas: meses desde quotaStartMonth hasta hoy (más los adelantados que
// queden más allá), con el estado de cada miembro activo por celda.
export async function getQuotaGrid(): Promise<QuotaGrid> {
  const [settings, activeMembers, quotaContributions] = await Promise.all([
    getSettings(),
    getActiveMembers(),
    db.select().from(contributions).where(eq(contributions.type, 'quota'))
  ])

  const months = buildQuotaGrid(
    activeMembers,
    quotaContributions,
    settings.quotaStartMonth,
    currentPeriodNow()
  )

  return { settings, activeMembers, months }
}
