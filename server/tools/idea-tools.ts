import { z } from 'zod'
import {
  changeIdeaStatus,
  createIdea,
  createIdeaSchema,
  getIdeaDetail,
  ideaStatusSchema,
  listIdeas
} from '../services/idea-service'
import { defineTool } from './types'

// Herramientas de ideas (fase 4). Eliminar una idea = descartarla (papelera); el borrado
// definitivo solo se hace desde la web.

export const ideaTools = [
  defineTool({
    name: 'listar_ideas',
    description: 'Lista las ideas (propuestas en ciernes) que no están descartadas, con su estado y autor.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const ideas = await listIdeas()
      return {
        ideas: ideas.map(idea => ({
          id: idea.id,
          titulo: idea.title,
          estado: idea.status,
          autor: idea.authorName,
          fecha: idea.createdAt
        }))
      }
    }
  }),

  defineTool({
    name: 'ver_idea',
    description: 'Detalle de una idea con sus comentarios y fotos.',
    kind: 'read',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (_actor, input) => {
      const detail = await getIdeaDetail(input.id)
      return {
        id: detail.idea.id,
        titulo: detail.idea.title,
        descripcion: detail.idea.description,
        estado: detail.idea.status,
        autor: detail.idea.authorName,
        comentarios: detail.comments.map(comment => ({
          autor: comment.authorName,
          texto: comment.body,
          fecha: comment.createdAt
        })),
        fotos: detail.media.length
      }
    }
  }),

  defineTool({
    name: 'crear_idea',
    description: 'Registra una idea nueva para que los propietarios la discutan.',
    kind: 'write',
    inputSchema: createIdeaSchema,
    handler: async (actor, input) => {
      const idea = await createIdea({ actor, ...input })
      return { ideaId: idea.id, titulo: idea.title, estado: idea.status }
    }
  }),

  defineTool({
    name: 'cambiar_estado_idea',
    description: 'Pasa una idea a discusión o la descarta (archivar). Una idea ya promovida a propuesta solo puede descartarse.',
    kind: 'write',
    inputSchema: ideaStatusSchema.extend({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const idea = await changeIdeaStatus({ actor, ideaId: input.id, status: input.status })
      return { ideaId: idea.id, estado: idea.status }
    }
  })
]
