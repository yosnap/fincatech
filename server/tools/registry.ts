import { runWithChannel } from '../utils/audit-channel'
import type { AuditChannel } from '../utils/audit-channel'
import type { SessionUser } from '../utils/rbac'
import { bankTools } from './bank-tools'
import { contributionTools } from './contribution-tools'
import { expenseTools } from './expense-tools'
import { ideaTools } from './idea-tools'
import { memberTools } from './member-tools'
import { proposalTools } from './proposal-tools'
import { reservationTools } from './reservation-tools'
import { settlementTools } from './settlement-tools'
import { taskTools } from './task-tools'
import type { ToolDefinition, ToolRunResult } from './types'

// Registro ÚNICO de herramientas (fase 4): lo consumen el servidor MCP y el agente de Telegram.
// Añadir una herramienta aquí la publica en los dos canales a la vez, con las mismas reglas y
// la misma auditoría (el servicio subyacente es el mismo que usa la web).

export const TOOLS: ToolDefinition[] = [
  ...bankTools,
  ...contributionTools,
  ...expenseTools,
  ...settlementTools,
  ...taskTools,
  ...ideaTools,
  ...proposalTools,
  ...reservationTools,
  ...memberTools
]

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS.find(tool => tool.name === name)
}

// Mensaje único cuando el actor no es Admin activo: se usa tanto en el MCP como en el bot.
const FORBIDDEN_MESSAGE = 'Solo un administrador activo puede usar esta herramienta'

function assertAdmin(actor: SessionUser | null): asserts actor is SessionUser {
  if (!actor || actor.role !== 'admin' || actor.banned) {
    throw createError({ statusCode: 403, statusMessage: FORBIDDEN_MESSAGE })
  }
}

// Traduce un error del servicio a algo que el modelo pueda explicar: mensaje legible + código de
// negocio (`possible_duplicate`, etc.). Nunca se filtra el stack ni datos internos.
function toToolError(error: unknown): ToolRunResult {
  const h3Error = error as { statusCode?: number, statusMessage?: string, data?: { code?: string } }
  return {
    ok: false,
    error: h3Error?.statusMessage ?? 'La operación no se pudo completar',
    code: h3Error?.data?.code
  }
}

// Ejecuta una herramienta: verifica el rol, valida la entrada con zod, ambienta el canal de
// auditoría y devuelve un resultado serializable (nunca lanza: el canal decide qué hacer).
export async function runTool(
  actor: SessionUser | null,
  name: string,
  input: unknown,
  channel: AuditChannel
): Promise<ToolRunResult> {
  try {
    assertAdmin(actor)
  } catch (error) {
    return toToolError(error)
  }

  const tool = getTool(name)
  if (!tool) {
    return { ok: false, error: `Herramienta desconocida: ${name}` }
  }

  const parsed = tool.inputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      error: `Entrada inválida: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}`
    }
  }

  try {
    const result = await runWithChannel(channel, () => tool.handler(actor, parsed.data as never))
    return { ok: true, result }
  } catch (error) {
    return toToolError(error)
  }
}
