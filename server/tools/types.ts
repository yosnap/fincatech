import type { z } from 'zod'
import type { SessionUser } from '../utils/rbac'

// Contrato de una herramienta (fase 4): la MISMA definición alimenta el servidor MCP y el
// agente de Telegram. Cada herramienta delega en un servicio existente — nunca SQL directo —,
// así hereda las reglas de negocio y la auditoría que ya tenían la web.

export type ToolKind = 'read' | 'write' | 'destructive'

export interface ToolDefinition {
  // snake_case: es el nombre que ve el modelo.
  name: string
  // En español y orientada al modelo: cuándo usarla, qué devuelve, qué NO hace.
  description: string
  kind: ToolKind
  inputSchema: z.ZodTypeAny
  handler: (actor: SessionUser, input: never) => Promise<unknown>
}

// Helper que conserva el tipo del input dentro del handler y lo borra en la lista heterogénea
// del registro (`runTool` ya lo ha validado con el mismo esquema antes de llamar).
export function defineTool<S extends z.ZodTypeAny>(definition: {
  name: string
  description: string
  kind: ToolKind
  inputSchema: S
  handler: (actor: SessionUser, input: z.infer<S>) => Promise<unknown>
}): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    inputSchema: definition.inputSchema,
    handler: (actor, input) => definition.handler(actor, input as z.infer<S>)
  }
}

export interface ToolRunResult {
  ok: boolean
  result?: unknown
  error?: string
  // Código de negocio del error (p. ej. 'possible_duplicate'), para que el modelo pueda
  // explicar el conflicto en vez de inventarse uno.
  code?: string
}
