import { z } from 'zod'
import { getActiveMembers } from '../services/bank-service'
import { defineTool } from './types'

// `listar_miembros` (fase 4): solo id y nombre. Es lo mínimo para resolver «el aporte de Ana»
// a un id, y es lo único que sale hacia un proveedor externo de IA — nada de correos ni roles.

export const memberTools = [
  defineTool({
    name: 'listar_miembros',
    description: 'Lista los copropietarios activos con su id y su nombre. Úsala para traducir un nombre a un id antes de crear o editar aportes, gastos o tareas.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const members = await getActiveMembers()
      return {
        miembros: members.map(member => ({ id: member.id, nombre: member.name }))
      }
    }
  })
]
