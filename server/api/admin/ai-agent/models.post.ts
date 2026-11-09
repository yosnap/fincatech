import { connectionSchema, resolveConnection } from '../../../services/ai-agent-settings'
import { listProviderModels } from '../../../services/ai-chat-client'
import { requireRole } from '../../../utils/rbac'
import { checkRateLimit } from '../../../utils/rate-limit'

// Modelos del proveedor indicado (o del guardado), sin guardar nada.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  if (!checkRateLimit(`ai-agent-models:${actor.id}`, { max: 20, windowMs: 10 * 60 * 1000 })) {
    throw createError({ statusCode: 429, statusMessage: 'Demasiadas consultas; espera unos minutos' })
  }
  const parsed = connectionSchema.safeParse(await readBody(event) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Datos inválidos' })
  }
  const connection = await resolveConnection(parsed.data)
  try {
    return { models: await listProviderModels(connection) }
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: error instanceof Error ? error.message : 'El proveedor no respondió' })
  }
})
