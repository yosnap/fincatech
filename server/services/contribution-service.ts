import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { bankTransactions, contributions, paymentProofs, users } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'
import { assertNotTrashed, notDeleted } from '../utils/soft-delete'
import {
  buildQuotaGrid,
  buildTransferDescription,
  currentPeriodNow,
  duplicateKey,
  expandQuotaPeriods,
  groupPossibleDuplicates,
  isDuplicateCheckedType,
  isOwnAutoTransferDeposit,
  isValidPeriod
} from './bank-core'
import {
  getActiveMembers,
  getSettings,
  restoreTransactionCore,
  trashTransactionCore,
  type ActiveMember,
  type FinanceSettings
} from './bank-service'

export const CONTRIBUTION_TYPES = ['pre_purchase', 'quota', 'extraordinary'] as const
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]

export const CONTRIBUTION_METHODS = ['cash', 'transfer'] as const
export type ContributionMethod = (typeof CONTRIBUTION_METHODS)[number]

// Executor mínimo para compartir la comprobación de duplicado entre servicios (crear un
// aporte hoy, restaurarlo de la papelera en la fase 8): siempre una transacción abierta,
// porque el advisory lock solo tiene sentido dentro de una.
type DuplicateGuardExecutor = Pick<typeof db, 'select' | 'execute'>

interface DuplicateGuardInput {
  memberId: string
  amountCents: number
  type: string
  period: string | null
  date: string
  // El usuario ya vio el aviso y pidió registrar igualmente.
  force?: boolean
}

// Bloquea el aporte y, si lo tiene, su movimiento vinculado, en el orden global del dominio
// financiero (movimiento antes que aporte — RT8-5). El aporte se lee primero SIN lock para
// saber qué movimiento hay que bloquear; si un link/unlink concurrente cambió el vínculo en
// ese hueco, se bloquea también el nuevo. Devuelve `transaction = null` cuando el movimiento
// ya no existe (se eliminó definitivamente).
async function lockContributionWithMovement(tx: TxExecutor, contributionId: string) {
  const [snapshot] = await tx.select().from(contributions).where(eq(contributions.id, contributionId))
  if (!snapshot) {
    return { contribution: null, transaction: null }
  }

  let transaction: typeof bankTransactions.$inferSelect | null = null
  if (snapshot.bankTransactionId) {
    const [row] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, snapshot.bankTransactionId)).for('update')
    transaction = row ?? null
  }

  const [contribution] = await tx.select().from(contributions)
    .where(eq(contributions.id, contributionId)).for('update')
  if (!contribution) {
    return { contribution: null, transaction: null }
  }

  if (contribution.bankTransactionId && contribution.bankTransactionId !== snapshot.bankTransactionId) {
    const [row] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, contribution.bankTransactionId)).for('update')
    transaction = row ?? null
  }

  return { contribution, transaction }
}

// Comprobación de «posible duplicado» compartida por las rutas que pueden crear dos aportes
// idénticos. Toma un `pg_advisory_xact_lock` sobre la clave de duplicado ANTES de leer: dos
// transacciones con la misma clave se serializan (la segunda espera a que la primera
// confirme) y la segunda ve la fila recién creada → 409. El lock se libera solo al
// confirmar o abortar la transacción; no hay unlock explícito ni riesgo de fuga.
export async function assertNoPossibleDuplicate(
  tx: DuplicateGuardExecutor,
  input: DuplicateGuardInput
): Promise<void> {
  if (input.force || !isDuplicateCheckedType(input.type)) return

  const key = duplicateKey({
    memberId: input.memberId,
    amountCents: input.amountCents,
    type: input.type,
    period: input.period,
    date: input.date
  })
  // hashtext() devuelve int4 → encaja con la firma de un argumento de pg_advisory_xact_lock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)

  const [existing] = await tx.select().from(contributions).where(and(
    eq(contributions.memberId, input.memberId),
    eq(contributions.amountCents, input.amountCents),
    eq(contributions.type, input.type),
    eq(contributions.date, input.date),
    // Lo que está en la papelera no existe para el usuario: no bloquea un registro nuevo
    // (misma regla que el detector de duplicados y el grid).
    notDeleted(contributions)
  )).limit(1)
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ya existe un aporte idéntico (mismo miembro, importe, tipo y fecha)',
      data: { code: 'possible_duplicate', existing }
    })
  }
}

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
  // Registrar aunque exista un aporte idéntico (el usuario ya vio el aviso de duplicado).
  force?: boolean
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
    // Aviso de posible duplicado (doble envío, o miembro y admin registrando lo mismo): 409
    // con el aporte existente para que la UI pregunte antes de crear otro igual. Va DENTRO
    // de la transacción y con advisory lock por clave de duplicado: si se comprobara antes
    // de abrirla, dos envíos simultáneos verían la tabla vacía y crearían ambos.
    await assertNoPossibleDuplicate(tx, {
      memberId: input.memberId,
      amountCents: input.amountCents,
      type: input.type,
      period: input.type === 'quota' ? input.period : null,
      date: input.date,
      force: input.force
    })

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

    // Marca de auto-creado (RT8-3): el movimiento y su aporte son la misma operación, así
    // que al mandar uno a la papelera se arrastra el otro en la misma transacción. Se
    // escribe después del insert porque el movimiento existe antes que el aporte.
    if (bankTransactionId && rows[0]) {
      await tx.update(bankTransactions)
        .set({ autoCreatedForContributionId: rows[0].id })
        .where(eq(bankTransactions.id, bankTransactionId))
    }

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
// cuyo movimiento fue eliminado definitivamente (purga la devuelve a pendiente).
// Orden de bloqueo global del dominio financiero: gasto → deudas → movimiento → aportes
// (RT8-5), por eso aquí el movimiento se bloquea ANTES que el aporte.
export async function linkContribution(input: LinkContributionInput) {
  return db.transaction(async (tx) => {
    const [transaction] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, input.bankTransactionId)).for('update')
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Movimiento bancario no encontrado' })
    }
    assertNotTrashed(transaction, 'El ingreso está en la papelera: restáuralo antes de vincular aportes')

    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    assertNotTrashed(contribution, 'El aporte está en la papelera: restáuralo antes de vincularlo')
    if (contribution.bankTransactionId) {
      throw createError({ statusCode: 409, statusMessage: 'El aporte ya está vinculado a un ingreso' })
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

    return updated!
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
    assertNotTrashed(contribution, 'El aporte está en la papelera: restáuralo antes de desvincularlo')
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

    return updated!
  })
}

interface UpdateContributionInput {
  contributionId: string
  actorId: string
  notes?: string | null
  date?: string
  amountCents?: number
  type?: ContributionType
  // 'YYYY-MM' para quota; null para el resto. Ausente = no tocar.
  period?: string | null
}

// Edición completa (admin): notas, fecha, importe, tipo y período. El método no se edita
// (cambiaría la naturaleza del vínculo bancario). Si el aporte es una transferencia
// individual con su ingreso auto-creado, ese movimiento se sincroniza (importe, fecha y
// descripción) para que el saldo siga cuadrando. Si el movimiento es compartido (adelanto) o
// se vinculó a mano, no se toca y por eso no se permite cambiar el importe sin desvincular.
export async function updateContribution(input: UpdateContributionInput) {
  return db.transaction(async (tx) => {
    const { contribution, transaction } = await lockContributionWithMovement(tx, input.contributionId)
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    assertNotTrashed(contribution, 'El aporte está en la papelera: restáuralo antes de editarlo')

    const next = {
      notes: input.notes !== undefined ? input.notes : contribution.notes,
      date: input.date ?? contribution.date,
      amountCents: input.amountCents ?? contribution.amountCents,
      type: input.type ?? contribution.type,
      period: input.period !== undefined ? input.period : contribution.period
    }
    // Pasar a no-cuota sin indicar período limpia el período heredado.
    if (next.type !== 'quota' && input.period === undefined) next.period = null

    if (next.type === 'quota') {
      if (!next.period || !isValidPeriod(next.period)) {
        throw createError({ statusCode: 400, statusMessage: 'La cuota requiere un período válido (YYYY-MM)' })
      }
    } else if (next.period) {
      throw createError({ statusCode: 400, statusMessage: 'Solo las cuotas mensuales llevan período' })
    }

    const amountChanged = next.amountCents !== contribution.amountCents
    let syncedTransactionId: string | null = null

    if (contribution.bankTransactionId && transaction) {
      assertNotTrashed(transaction, 'El ingreso vinculado está en la papelera: restáuralo antes de editar el aporte')
      const siblings = await tx.select({ id: contributions.id }).from(contributions)
        .where(and(eq(contributions.bankTransactionId, transaction.id), notDeleted(contributions)))
      const [member] = await tx.select({ name: users.name }).from(users).where(eq(users.id, contribution.memberId))
      const memberName = member?.name ?? ''

      const syncable = isOwnAutoTransferDeposit({
        contributionId: contribution.id,
        method: contribution.method,
        linkedCount: siblings.length,
        autoCreatedForContributionId: transaction.autoCreatedForContributionId
      })

      if (syncable) {
        await tx.update(bankTransactions).set({
          amountCents: next.amountCents,
          date: next.date,
          description: buildTransferDescription(next.type, next.period ? [next.period] : [], memberName)
        }).where(eq(bankTransactions.id, transaction.id))
        syncedTransactionId = transaction.id
      } else {
        if (amountChanged) {
          throw createError({
            statusCode: 409,
            statusMessage: 'El ingreso vinculado es compartido o se vinculó a mano: desvincula el aporte antes de cambiar el importe'
          })
        }
        // Invariante de conciliación: el depósito nunca es anterior a la fecha del aporte.
        if (transaction.date < next.date) {
          throw createError({ statusCode: 400, statusMessage: 'El ingreso vinculado es anterior a la nueva fecha del aporte' })
        }
      }
    }

    const [updated] = await tx.update(contributions)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(contributions.id, contribution.id))
      .returning()
      .catch((error: unknown) => {
        if (getPgErrorCode(error) === '23505') {
          throw createError({ statusCode: 409, statusMessage: 'Ese miembro ya tiene cuota registrada en ese mes' })
        }
        throw error
      })

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_updated',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: {
        before: { date: contribution.date, amountCents: contribution.amountCents, type: contribution.type, period: contribution.period, notes: contribution.notes },
        after: next,
        syncedTransactionId
      }
    }, tx)

    return updated!
  })
}

interface DeleteContributionInput {
  contributionId: string
  actorId: string
  actorRole: string
}

interface RestoreContributionInput {
  contributionId: string
  actorId: string
  actorRole: string
  // Restaurar aunque ya exista otro aporte idéntico (la web ofrece «Restaurar igualmente»).
  force?: boolean
}

// Borrado lógico (papelera, fase 8): autor del registro o Admin, igual que la regla de
// producto anterior. El aporte conserva su vínculo bancario y su justificante, pero deja de
// contar en saldo, conciliación, grid y detector de duplicados.
//
// Cascada del ingreso auto-creado (RT8-3): si el aporte es una transferencia con su ingreso
// espejo, se mueven juntos a la papelera — el saldo no puede seguir contando un ingreso cuyo
// aporte ya no existe. Solo lo hace el Admin: un Propietario que manda su aporte a la papelera
// deja el ingreso vivo y el resumen avisa de «ingreso sin aporte asociado» para que el Admin
// decida (decisión del usuario en la validación).
export async function trashContribution(input: DeleteContributionInput) {
  return db.transaction(async (tx) => {
    const { contribution, transaction } = await lockContributionWithMovement(tx, input.contributionId)
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (input.actorRole !== 'admin' && contribution.registeredBy !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo puedes eliminar los aportes que tú registraste' })
    }
    // Idempotente: dos clics no fallan ni reescriben el rastro.
    if (contribution.deletedAt) {
      return contribution
    }

    let cascadedTransactionId: string | null = null
    if (
      input.actorRole === 'admin'
      && transaction
      && !transaction.deletedAt
      && transaction.autoCreatedForContributionId === contribution.id
    ) {
      await trashTransactionCore(tx, {
        transactionId: transaction.id,
        actorId: input.actorId,
        cascadeFrom: 'contribution'
      })
      cascadedTransactionId = transaction.id
    }

    const [updated] = await tx.update(contributions)
      .set({ deletedAt: new Date(), deletedBy: input.actorId })
      .where(eq(contributions.id, contribution.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_trashed',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: {
        memberId: contribution.memberId,
        type: contribution.type,
        period: contribution.period,
        amountCents: contribution.amountCents,
        cascadedTransactionId
      }
    }, tx)

    return updated!
  })
}

// Restaurar (solo Admin, desde la papelera). Conflictos que se comprueban ANTES de limpiar la
// marca (RT8-8): la cuota del mismo miembro y mes ya existe (409), el miembro está de baja
// (409) o su ingreso espejo se eliminó definitivamente (se restaura sin vínculo + aviso).
export async function restoreContribution(input: RestoreContributionInput) {
  return db.transaction(async (tx) => {
    const { contribution, transaction } = await lockContributionWithMovement(tx, input.contributionId)
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (!contribution.deletedAt) {
      return { contribution, warnings: [] as string[] }
    }

    const [member] = await tx.select({ id: users.id, banned: users.banned, role: users.role })
      .from(users)
      .where(eq(users.id, contribution.memberId))
    if (!member || member.banned || (member.role !== 'admin' && member.role !== 'owner')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede restaurar: el miembro del aporte está de baja'
      })
    }

    // Mismo criterio y mismo advisory lock que al registrar (RT-6): restaurar dos veces la
    // misma fila o restaurar mientras otro usuario registra lo mismo no puede crear dos
    // aportes idénticos. La web puede reintentar con «Restaurar igualmente» (force).
    await assertNoPossibleDuplicate(tx, {
      memberId: contribution.memberId,
      amountCents: contribution.amountCents,
      type: contribution.type,
      period: contribution.period,
      date: contribution.date,
      force: input.force
    })

    // El ingreso espejo se restaura con el aporte; si se eliminó definitivamente, el aporte
    // vuelve sin vínculo (queda «pendiente de depósito» si era efectivo) y se avisa.
    const warnings: string[] = []
    const linkedTransactionId = contribution.bankTransactionId
    if (linkedTransactionId) {
      if (!transaction) {
        await tx.update(contributions)
          .set({ bankTransactionId: null, updatedAt: new Date() })
          .where(eq(contributions.id, contribution.id))
        warnings.push('El ingreso vinculado se había eliminado definitivamente: el aporte se ha restaurado sin vínculo')
      } else if (
        input.actorRole === 'admin'
        && transaction.autoCreatedForContributionId === contribution.id
      ) {
        await restoreTransactionCore(tx, { transactionId: transaction.id, actorId: input.actorId })
      } else if (transaction.deletedAt) {
        warnings.push('El ingreso vinculado sigue en la papelera: restáuralo para que el aporte cuente como depositado')
      }
    }

    const [updated] = await tx.update(contributions)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(eq(contributions.id, contribution.id))
      .returning()
      .catch((error: unknown) => {
        if (getPgErrorCode(error) === '23505') {
          throw createError({ statusCode: 409, statusMessage: 'Ese miembro ya tiene cuota registrada en ese mes' })
        }
        throw error
      })

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_restored',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: {
        memberId: contribution.memberId,
        type: contribution.type,
        period: contribution.period,
        amountCents: contribution.amountCents,
        warnings
      }
    }, tx)

    return { contribution: updated!, warnings }
  })
}

// Borrado definitivo (solo Admin, solo desde la papelera — RT8-4). No hay archivos propios:
// el justificante de una transferencia cuelga de su movimiento, que se purga por separado.
export async function purgeContribution(input: { contributionId: string, actorId: string }) {
  return db.transaction(async (tx) => {
    const [contribution] = await tx.select().from(contributions)
      .where(eq(contributions.id, input.contributionId)).for('update')
    if (!contribution) {
      throw createError({ statusCode: 404, statusMessage: 'Aporte no encontrado' })
    }
    if (!contribution.deletedAt) {
      throw createError({ statusCode: 409, statusMessage: 'Solo se puede eliminar definitivamente lo que está en la papelera' })
    }

    await tx.delete(contributions).where(eq(contributions.id, contribution.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'contribution_purged',
      entityType: 'contribution',
      entityId: contribution.id,
      metadata: {
        memberId: contribution.memberId,
        type: contribution.type,
        period: contribution.period,
        amountCents: contribution.amountCents
      }
    }, tx)

    return { contributionId: contribution.id }
  })
}

export interface ContributionFilters {
  memberId?: string
  type?: string
  // 'YYYY-MM-DD' (fecha del aporte), ambos inclusive.
  from?: string
  to?: string
}

// Listado de aportes vivos con filtros: lo usan el endpoint `/api/bank/contributions` y la
// herramienta `listar_aportes` del MCP (misma consulta, misma regla de papelera).
export async function listContributions(filters: ContributionFilters = {}) {
  const conditions = [notDeleted(contributions)]
  if (filters.memberId) conditions.push(eq(contributions.memberId, filters.memberId))
  if (filters.type) conditions.push(eq(contributions.type, filters.type))
  if (filters.from) conditions.push(gte(contributions.date, filters.from))
  if (filters.to) conditions.push(lte(contributions.date, filters.to))

  return db.select().from(contributions)
    .where(and(...conditions))
    .orderBy(asc(contributions.date), asc(contributions.createdAt))
}

export interface PendingQuotaCell {
  memberId: string
  memberName: string
  period: string
}

// Cuotas que faltan por pagar (meses del grid sin aporte de ese miembro). Es lo que responde
// la herramienta `cuotas_pendientes`: no incluye meses futuros, porque el grid no los genera.
export async function getPendingQuotas(): Promise<{ settings: FinanceSettings, pending: PendingQuotaCell[] }> {
  const grid = await getQuotaGrid()
  const nameById = new Map(grid.activeMembers.map(member => [member.id, member.name]))
  const pending: PendingQuotaCell[] = []

  for (const month of grid.months) {
    for (const cell of month.cells) {
      if (cell.contribution) continue
      pending.push({
        memberId: cell.memberId,
        memberName: nameById.get(cell.memberId) ?? cell.memberId,
        period: month.period
      })
    }
  }

  return { settings: grid.settings, pending }
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
    db.select().from(contributions).where(and(eq(contributions.type, 'quota'), notDeleted(contributions)))
  ])

  const months = buildQuotaGrid(
    activeMembers,
    quotaContributions,
    settings.quotaStartMonth,
    currentPeriodNow()
  )

  return { settings, activeMembers, months }
}

export interface DuplicateGroupItem {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  type: string
  period: string | null
  method: string
  date: string
  bankTransactionId: string | null
  registeredByName: string
  notes: string | null
  createdAt: Date
}

// Grupos de posibles aportes duplicados ya registrados (incluye cuotas por completitud,
// aunque el índice único las hace imposibles salvo datos antiguos). Orden por createdAt
// dentro de cada grupo: el primero suele ser el original.
export async function listPossibleDuplicates(): Promise<DuplicateGroupItem[][]> {
  // Solo aportes vivos: la tarjeta de duplicados no debe proponer limpiar algo que ya está
  // en la papelera (y el criterio es el mismo que la comprobación al registrar).
  const rows = await db.select().from(contributions)
    .where(notDeleted(contributions))
    .orderBy(asc(contributions.createdAt))
  const groups = groupPossibleDuplicates(rows)
  if (groups.length === 0) return []

  const userIds = [...new Set(groups.flat().flatMap(c => [c.memberId, c.registeredBy]))]
  const userRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
  const nameById = new Map(userRows.map(u => [u.id, u.name]))

  return groups.map(group => group.map(c => ({
    id: c.id,
    memberId: c.memberId,
    memberName: nameById.get(c.memberId) ?? c.memberId,
    amountCents: c.amountCents,
    type: c.type,
    period: c.period,
    method: c.method,
    date: c.date,
    bankTransactionId: c.bankTransactionId,
    registeredByName: nameById.get(c.registeredBy) ?? c.registeredBy,
    notes: c.notes,
    createdAt: c.createdAt
  })))
}
