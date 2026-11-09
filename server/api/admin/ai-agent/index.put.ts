import { saveSettings, saveSettingsSchema } from '../../../services/ai-agent-settings'
import { requireRole } from '../../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const parsed = saveSettingsSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Datos inválidos' })
  }
  return saveSettings(parsed.data, actor.id)
})
