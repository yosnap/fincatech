import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { telegramConversationMessages, telegramLinks, telegramPendingActions, users } from '../db/schema'
import { getTool, runTool } from '../tools/registry'
import { getEnv } from '../utils/env'
import type { SessionUser } from '../utils/rbac'
import { sanitizeAgentReply } from './telegram-text'

// Acciones de escritura del agente de Telegram pendientes de confirmación. El agente nunca
// ejecuta una escritura: crea la acción y el bot envía un resumen con «Confirmar» / «Cancelar».
// La ejecución ocurre aquí, una sola vez, al pulsar el botón.

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000

const SUMMARY_VALUE_MAX = 200

function formatSummaryValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  // Sin saltos de línea dentro de un valor: no puede falsear otras líneas del resumen.
  const flat = raw.replace(/[\r\n]+/g, ' ')
  return flat.length > SUMMARY_VALUE_MAX ? `${flat.slice(0, SUMMARY_VALUE_MAX)}…` : flat
}

// Claves en el orden del esquema (no en el que elija el modelo) y luego el resto.
function orderedKeys(toolName: string, input: Record<string, unknown>): string[] {
  const shape = (getTool(toolName)?.inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape
  const schemaKeys = shape ? Object.keys(shape) : []
  return [...schemaKeys.filter(key => key in input), ...Object.keys(input).filter(key => !schemaKeys.includes(key)).sort()]
}

// Resumen DETERMINISTA (no lo escribe el modelo), construido con la entrada YA validada por
// zod: lo que se ve es exactamente lo que se ejecuta, valores por defecto incluidos. Cada
// valor se acota por separado, así que ningún campo (p. ej. un id) queda fuera del resumen.
export function summarizeAction(toolName: string, input: Record<string, unknown>, appUrl: string): string {
  const tool = getTool(toolName)
  const lines = orderedKeys(toolName, input)
    .filter(key => input[key] !== undefined)
    .map(key => `- ${key}: ${formatSummaryValue(input[key])}`)
  const heading = tool?.kind === 'destructive' ? 'Acción destructiva' : 'Acción'
  return sanitizeAgentReply([`${heading}: ${toolName}`, ...lines].join('\n'), appUrl)
}

export async function createPendingAction(params: {
  chatId: string
  userId: string
  tool: string
  input: Record<string, unknown>
}) {
  const [action] = await db.insert(telegramPendingActions).values({
    chatId: params.chatId,
    userId: params.userId,
    tool: params.tool,
    input: params.input,
    summary: summarizeAction(params.tool, params.input, getEnv().BETTER_AUTH_URL),
    expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS)
  }).returning()
  if (!action) throw new Error('No se pudo crear la acción pendiente')
  return action
}

export interface ResolveContext {
  actionId: string
  chatId: string
  // `callback_query.from.id`: debe coincidir con la cuenta de Telegram vinculada.
  telegramUserId: string
}

export interface ResolveOutcome {
  ok: boolean
  // Texto con el que se reemplaza el mensaje de confirmación.
  text: string
}

// Admin activo resuelto desde el chat vinculado. Se vuelve a comprobar en el momento de
// confirmar: el rol pudo cambiar en los 10 minutos de vida de la acción.
export async function resolveLinkedAdmin(chatId: string, telegramUserId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      banned: users.banned,
      pendingApproval: users.pendingApproval,
      linkedTelegramUserId: telegramLinks.telegramUserId
    })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(eq(telegramLinks.chatId, chatId))
  if (!row || row.linkedTelegramUserId !== telegramUserId) return null
  if (row.role !== 'admin' || row.banned || row.pendingApproval) return null
  return { id: row.id, role: row.role, banned: Boolean(row.banned) }
}

// La memoria es secundaria: si falla, el resultado se sigue comunicando al admin.
async function rememberOutcome(chatId: string, text: string) {
  await db.insert(telegramConversationMessages).values({ chatId, role: 'assistant', content: text })
    .catch(error => console.error('[telegram-confirmations] no se pudo guardar en la memoria', error))
}

export async function confirmPendingAction(ctx: ResolveContext): Promise<ResolveOutcome> {
  const actor = await resolveLinkedAdmin(ctx.chatId, ctx.telegramUserId)
  if (!actor) {
    return { ok: false, text: 'No tienes permiso para confirmar esta acción.' }
  }

  // Transición atómica pending → executing: con dos pulsaciones simultáneas solo una gana.
  const [claimed] = await db.update(telegramPendingActions)
    .set({ status: 'executing', executingAt: new Date() })
    .where(and(
      eq(telegramPendingActions.id, ctx.actionId),
      eq(telegramPendingActions.chatId, ctx.chatId),
      eq(telegramPendingActions.userId, actor.id),
      eq(telegramPendingActions.status, 'pending'),
      gt(telegramPendingActions.expiresAt, sql`now()`)
    ))
    .returning()

  if (!claimed) {
    return { ok: false, text: await explainUnclaimable(ctx) }
  }

  const result = await runTool(actor, claimed.tool, claimed.input, 'telegram')
  // Si este UPDATE falla, la acción ya se aplicó: se loguea y se informa igualmente; la
  // revisión periódica de huérfanas la cerrará como `failed` con aviso.
  await db.update(telegramPendingActions)
    .set({
      status: result.ok ? 'done' : 'failed',
      result: result.ok ? (result.result ?? null) : null,
      error: result.ok ? null : (result.error ?? 'Error desconocido'),
      resolvedAt: new Date()
    })
    .where(eq(telegramPendingActions.id, claimed.id))
    .catch(error => console.error('[telegram-confirmations] no se pudo cerrar la acción', claimed.id, error))

  const text = result.ok
    ? `Hecho.\n${claimed.summary}`
    : `No se pudo completar: ${result.error ?? 'error desconocido'}\n${claimed.summary}`
  await rememberOutcome(ctx.chatId, `[Resultado de la acción confirmada] ${text}`)
  return { ok: result.ok, text }
}

export async function cancelPendingAction(ctx: ResolveContext): Promise<ResolveOutcome> {
  const actor = await resolveLinkedAdmin(ctx.chatId, ctx.telegramUserId)
  if (!actor) {
    return { ok: false, text: 'No tienes permiso para cancelar esta acción.' }
  }
  const [cancelled] = await db.update(telegramPendingActions)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(and(
      eq(telegramPendingActions.id, ctx.actionId),
      eq(telegramPendingActions.chatId, ctx.chatId),
      eq(telegramPendingActions.userId, actor.id),
      eq(telegramPendingActions.status, 'pending')
    ))
    .returning()
  if (!cancelled) {
    return { ok: false, text: await explainUnclaimable(ctx) }
  }
  const text = `Cancelado. No se ha cambiado nada.\n${cancelled.summary}`
  await rememberOutcome(ctx.chatId, `[Acción cancelada por el admin] ${cancelled.summary}`)
  return { ok: true, text }
}

async function explainUnclaimable(ctx: ResolveContext): Promise<string> {
  const action = await db.query.telegramPendingActions.findFirst({
    where: and(eq(telegramPendingActions.id, ctx.actionId), eq(telegramPendingActions.chatId, ctx.chatId))
  })
  if (!action) return 'Esta acción no existe.'
  if (action.status === 'pending') {
    // Caducada: se marca para que no quede colgando.
    await db.update(telegramPendingActions)
      .set({ status: 'expired', resolvedAt: new Date() })
      .where(and(eq(telegramPendingActions.id, action.id), eq(telegramPendingActions.status, 'pending')))
    return `La confirmación ha caducado (10 minutos). Vuelve a pedírmelo si sigue siendo necesario.\n${action.summary}`
  }
  const labels: Record<string, string> = {
    executing: 'se está ejecutando',
    done: 'ya se ejecutó',
    failed: 'ya se intentó y falló',
    cancelled: 'se canceló',
    expired: 'caducó'
  }
  return `Esta acción ${labels[action.status] ?? 'ya no está pendiente'}.\n${action.summary}`
}

// Una ejecución nunca dura minutos: si una acción lleva más de esto en `executing`, el proceso
// murió a mitad (reinicio) y no se sabe si llegó a aplicarse.
export const ORPHAN_EXECUTION_AGE_MS = 5 * 60 * 1000

// Marca `failed` las ejecuciones huérfanas y las devuelve para avisar al chat (que el admin
// lo revise en la web). `olderThanMs` evita cerrar una ejecución en curso de otra instancia.
export async function failOrphanedExecutions(olderThanMs = ORPHAN_EXECUTION_AGE_MS): Promise<{ chatId: string, summary: string }[]> {
  return db.update(telegramPendingActions)
    .set({ status: 'failed', error: 'Interrumpida por un reinicio del servidor', resolvedAt: new Date() })
    .where(and(
      eq(telegramPendingActions.status, 'executing'),
      lt(telegramPendingActions.executingAt, new Date(Date.now() - olderThanMs))
    ))
    .returning({ chatId: telegramPendingActions.chatId, summary: telegramPendingActions.summary })
}
