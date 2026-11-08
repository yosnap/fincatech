import { z } from 'zod'
import { cancelProposal, getProposalDetail, listProposals } from '../services/proposal-service'
import { euros } from './format'
import { defineTool } from './types'

// Herramientas de propuestas (fase 4): consulta y cancelación. Votar, aprobar y borrar
// definitivamente se quedan en la web (son acciones con impacto económico o irreversible).

export const proposalTools = [
  defineTool({
    name: 'listar_propuestas',
    description: 'Lista las propuestas que no están canceladas, con su estado (voting/approved) y autor.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const proposals = await listProposals()
      return {
        propuestas: proposals.map(proposal => ({
          id: proposal.id,
          titulo: proposal.title,
          estado: proposal.status,
          autor: proposal.authorName,
          fecha: proposal.createdAt
        }))
      }
    }
  }),

  defineTool({
    name: 'ver_propuesta',
    description: 'Detalle de una propuesta con sus opciones (cotizaciones), precio de cada una, votos y progreso de votación.',
    kind: 'read',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const detail = await getProposalDetail(input.id, actor.id)
      return {
        id: detail.proposal.id,
        titulo: detail.proposal.title,
        descripcion: detail.proposal.description,
        estado: detail.proposal.status,
        autor: detail.proposal.authorName,
        opciones: detail.quotes.map(quote => ({
          id: quote.id,
          etiqueta: quote.label,
          precio: euros(quote.priceCents),
          votos: quote.voteCount
        })),
        votosEmitidos: detail.votedCount,
        votantesElegibles: detail.totalEligibleVoters,
        miVoto: detail.myVoteQuoteId
      }
    }
  }),

  defineTool({
    name: 'cancelar_propuesta',
    description: 'Cancela una propuesta que sigue en votación. Una propuesta ya aprobada no se puede cancelar (generó una derrama).',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const proposal = await cancelProposal({
        proposalId: input.id,
        actorId: actor.id,
        actorRole: actor.role
      })
      return { propuestaId: proposal.id, estado: proposal.status }
    }
  })
]
