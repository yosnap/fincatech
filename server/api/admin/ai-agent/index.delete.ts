import { resetSettings } from '../../../services/ai-agent-settings'
import { requireRole } from '../../../utils/rbac'

// «Restablecer»: vuelve a las variables de entorno y borra la clave guardada.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  return resetSettings(actor.id)
})
