import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOLS, runTool } from './registry'
import type { SessionUser } from '../utils/rbac'

// Construye el servidor MCP para una petición concreta, con el actor ya resuelto por el canal
// de autenticación (OAuth, fase 4). Todas las herramientas salen del registro único
// (`registry.ts`), el mismo que usa el agente de Telegram: misma definición, mismas reglas
// del servicio y misma auditoría. El actor se cierra en el callback, nunca lo aporta el
// cliente: `runTool` lo re-verifica (admin, no banned) antes de cada ejecución.

export function createMcpServer(actor: SessionUser): McpServer {
  const server = new McpServer({
    name: 'fincatech',
    version: '1.0.0'
  })

  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      // Anotaciones del spec MCP: pistas para el cliente, no enforcement — la autorización
      // real vive en `runTool` y en el servicio subyacente.
      annotations: {
        readOnlyHint: tool.kind === 'read',
        destructiveHint: tool.kind === 'destructive',
        openWorldHint: false
      }
    }, async (args) => {
      const result = await runTool(actor, tool.name, args, 'mcp')
      return result.ok
        ? {
            structuredContent: {
              ...(result.result as Record<string, unknown>)
            },
            content: [{ type: 'text', text: JSON.stringify(result.result ?? {}) }]
          }
        : {
            content: [{
              type: 'text',
              text: result.code
                ? `${result.error} (código: ${result.code})`
                : result.error ?? 'La operación no se pudo completar'
            }],
            isError: true
          }
    })
  }

  return server
}
