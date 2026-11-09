import { z } from 'zod'
import type { ToolDefinition } from '../tools/types'
import { getEnv } from '../utils/env'

// Cliente mínimo de `/chat/completions` para cualquier API compatible con OpenAI con function
// calling (Nan Builders, OpenRouter…). Sin SDK: mismo patrón `fetch` que `vision-ocr.ts`.

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export type ChatMessage
  = | { role: 'system' | 'user', content: string }
    | { role: 'assistant', content: string | null, tool_calls?: ChatToolCall[] }
    | { role: 'tool', tool_call_id: string, content: string }

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ChatCompletionResult {
  message: { content: string | null, tool_calls?: ChatToolCall[] }
  usage?: ChatUsage
}

export interface ChatTool {
  type: 'function'
  function: { name: string, description: string, parameters: Record<string, unknown> }
}

const REQUEST_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 1_500

function agentApiKey(): string | undefined {
  const env = getEnv()
  return env.AI_AGENT_API_KEY ?? env.NAN_BUILDERS_API_KEY
}

export function isAgentConfigured(): boolean {
  return !!getEnv().AI_AGENT_MODEL && !!agentApiKey()
}

// zod 4 → JSON Schema (entrada). Lo que zod no puede representar (refine, transform) se
// relaja a `any`: la validación real la repite `runTool` con el esquema zod original.
export function toolParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
    return json.type === 'object' ? json : { type: 'object', properties: {} }
  } catch {
    return { type: 'object', properties: {} }
  }
}

let cachedTools: ChatTool[] | undefined

export function toChatTools(tools: ToolDefinition[]): ChatTool[] {
  if (cachedTools && cachedTools.length === tools.length) return cachedTools
  cachedTools = tools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: toolParameters(tool.inputSchema) }
  }))
  return cachedTools
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

// `deadline` (epoch ms) acota la llamada completa, reintento incluido: nunca se espera más
// allá del plazo global del bucle del agente.
export async function chatCompletion(messages: ChatMessage[], tools: ChatTool[], deadline = Date.now() + REQUEST_TIMEOUT_MS): Promise<ChatCompletionResult> {
  const env = getEnv()
  const apiKey = agentApiKey()
  if (!env.AI_AGENT_MODEL || !apiKey) {
    throw new Error('Agente IA no configurado (faltan AI_AGENT_MODEL o el token del proveedor)')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  }
  // OpenRouter: cabeceras opcionales de atribución de la app.
  if (env.AI_AGENT_BASE_URL.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = env.BETTER_AUTH_URL
    headers['X-Title'] = 'FincaTech'
  }
  const body = JSON.stringify({ model: env.AI_AGENT_MODEL, messages, tools, tool_choice: 'auto' })

  // Un único reintento ante 429/5xx o fallo de red, solo si queda margen en el plazo.
  const canRetry = () => deadline - Date.now() > RETRY_DELAY_MS + 5_000
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())
    if (remaining <= 0) throw new Error('Plazo agotado esperando al proveedor IA')
    let response: Response
    try {
      response = await fetch(`${env.AI_AGENT_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(remaining)
      })
    } catch (error) {
      if (attempt === 0 && canRetry()) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
      throw error
    }

    if (!response.ok) {
      if (attempt === 0 && isRetryable(response.status) && canRetry()) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
      throw new Error(`Proveedor IA respondió ${response.status}`)
    }

    const json = await response.json() as { choices?: { message?: ChatCompletionResult['message'] }[], usage?: ChatUsage }
    const message = json.choices?.[0]?.message
    if (!message) throw new Error('Respuesta del proveedor IA sin mensaje')
    return { message, usage: json.usage }
  }
}
