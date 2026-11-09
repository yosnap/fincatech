import { z } from 'zod'
import { connectionSchema, resolveConnection, testToolCalling } from '../../../services/ai-agent-settings'
import { requireRole } from '../../../utils/rbac'
import { checkRateLimit } from '../../../utils/rate-limit'

const bodySchema = connectionSchema.extend({ model: z.string().trim().min(1).max(200) })

// Prueba de function calling con las herramientas reales (no ejecuta ninguna). Gasta tokens:
// limitada por Admin.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  if (!checkRateLimit(`ai-agent-test:${actor.id}`, { max: 10, windowMs: 10 * 60 * 1000 })) {
    throw createError({ statusCode: 429, statusMessage: 'Demasiadas pruebas; espera unos minutos' })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Datos inválidos' })
  }
  const { model, ...connectionInput } = parsed.data
  const connection = await resolveConnection(connectionInput, model)
  return { results: await testToolCalling(connection) }
})
