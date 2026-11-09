import { getSettingsView } from '../../../services/ai-agent-settings'
import { requireRole } from '../../../utils/rbac'

// Ajustes del asistente IA (sin secretos: de la clave solo se dice de dónde sale y su final).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])
  return getSettingsView()
})
