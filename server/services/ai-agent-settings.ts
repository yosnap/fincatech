import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { aiAgentSettings } from '../db/schema'
import { TOOLS, getTool } from '../tools/registry'
import { writeAuditLog } from '../utils/audit'
import { getEnv } from '../utils/env'
import { sealSecret } from '../utils/secret-box'
import { SETTINGS_ID, envApiKey, getAgentConfig, invalidateAgentConfigCache, isConfigUsable, loadSettingsRow, normalizeBaseUrl, resolveAgentConfig } from './ai-agent-config'
import type { AgentConfig, ProviderConnection, SettingsRow } from './ai-agent-config'
import { chatCompletion, toChatTools } from './ai-chat-client'

// Ajustes del asistente IA desde la web (solo Admin): vista sin secretos, guardado, conexión
// para listar modelos y prueba de function calling con las herramientas reales.

// HTTPS obligatorio: la clave viaja en la cabecera. En desarrollo se admite loopback.
export function isAllowedBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    // Sin credenciales, query ni fragmento: nada que pueda acabar mostrado o auditado.
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:') return true
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'http:' && loopback && process.env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

const baseUrlSchema = z.string().trim().max(300).refine(isAllowedBaseUrl, 'La URL del proveedor debe empezar por https://')
const apiKeySchema = z.string().trim().min(8, 'La clave parece demasiado corta').max(500)

export const saveSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: baseUrlSchema,
  model: z.string().trim().min(1).max(200).nullable(),
  // Ausente: se conserva la guardada (si la URL no cambia). Cadena: se sustituye.
  apiKey: apiKeySchema.optional(),
  // Borra la clave guardada y vuelve a la del entorno (si aplica a esa URL).
  clearApiKey: z.boolean().optional()
})

export const connectionSchema = z.object({
  baseUrl: baseUrlSchema.optional(),
  apiKey: apiKeySchema.optional()
})

export interface SettingsView {
  enabled: boolean
  baseUrl: string
  model: string | null
  keySource: AgentConfig['keySource']
  keyHint: string | null
  keyUnreadable: boolean
  envBaseUrl: string
  envModel: string | null
  envKeyAvailable: boolean
  configured: boolean
  updatedAt: string | null
}

export async function getSettingsView(): Promise<SettingsView> {
  const env = getEnv()
  const row = await loadSettingsRow()
  const config = resolveAgentConfig(row, env)
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model ?? null,
    keySource: config.keySource,
    keyHint: config.keySource === 'db' ? (row?.apiKeyHint ?? null) : null,
    keyUnreadable: config.keyUnreadable,
    envBaseUrl: normalizeBaseUrl(env.AI_AGENT_BASE_URL),
    envModel: env.AI_AGENT_MODEL ?? null,
    envKeyAvailable: !!envApiKey(env),
    configured: isConfigUsable(config),
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null
  }
}

interface EnvDefaults {
  AI_AGENT_BASE_URL: string
  AI_AGENT_MODEL?: string
}

type StoredValues = Pick<SettingsRow, 'enabled' | 'baseUrl' | 'model' | 'apiKeyCiphertext' | 'apiKeyHint'>

// Pura: qué se guarda. Reglas:
// - Una clave guardada no se reutiliza con otro proveedor: cambiar la URL la descarta.
// - Los valores iguales a los del entorno se guardan como null, para seguir al entorno si
//   cambia después (guardar solo el interruptor no «congela» la URL ni el modelo).
// - Con clave guardada, la URL se guarda siempre explícita: la clave va pegada a su URL.
export function computeStoredValues(
  input: z.infer<typeof saveSettingsSchema>,
  current: SettingsRow | undefined,
  env: EnvDefaults,
  seal: (plain: string) => string = sealSecret
): StoredValues {
  const envBaseUrl = normalizeBaseUrl(env.AI_AGENT_BASE_URL)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const previousBaseUrl = normalizeBaseUrl(current?.baseUrl ?? envBaseUrl)

  let apiKeyCiphertext = current?.apiKeyCiphertext ?? null
  let apiKeyHint = current?.apiKeyHint ?? null
  if (input.apiKey) {
    apiKeyCiphertext = seal(input.apiKey)
    apiKeyHint = input.apiKey.slice(-4)
  } else if (input.clearApiKey || baseUrl !== previousBaseUrl) {
    apiKeyCiphertext = null
    apiKeyHint = null
  }

  return {
    enabled: input.enabled,
    baseUrl: apiKeyCiphertext || baseUrl !== envBaseUrl ? baseUrl : null,
    model: input.model && input.model !== env.AI_AGENT_MODEL ? input.model : null,
    apiKeyCiphertext,
    apiKeyHint
  }
}

export async function saveSettings(input: z.infer<typeof saveSettingsSchema>, actorId: string): Promise<SettingsView> {
  const current = await loadSettingsRow()
  const values = { ...computeStoredValues(input, current, getEnv()), updatedBy: actorId, updatedAt: new Date() }
  await db.insert(aiAgentSettings)
    .values({ id: SETTINGS_ID, ...values })
    .onConflictDoUpdate({ target: aiAgentSettings.id, set: values })
  invalidateAgentConfigCache()

  // Sin la clave ni su pista en la auditoría: solo si cambió.
  await writeAuditLog({
    actorId,
    action: 'ai_agent.settings_updated',
    entityType: 'ai_agent_settings',
    entityId: SETTINGS_ID,
    metadata: {
      enabled: values.enabled,
      baseUrl: values.baseUrl,
      model: values.model,
      apiKeyChanged: (current?.apiKeyCiphertext ?? null) !== values.apiKeyCiphertext
    }
  })
  return getSettingsView()
}

// Vuelve a las variables de entorno: borra la fila (y con ella la clave guardada).
export async function resetSettings(actorId: string): Promise<SettingsView> {
  await db.delete(aiAgentSettings).where(eq(aiAgentSettings.id, SETTINGS_ID))
  invalidateAgentConfigCache()
  await writeAuditLog({ actorId, action: 'ai_agent.settings_reset', entityType: 'ai_agent_settings', entityId: SETTINGS_ID })
  return getSettingsView()
}

// Pura: conexión para listar modelos o probar SIN guardar. Con clave nueva se usa tal cual;
// sin ella, la clave efectiva solo vale para su propio proveedor (nunca se envía a otra URL).
export function connectionFor(input: z.infer<typeof connectionSchema>, config: AgentConfig, model?: string): ProviderConnection | null {
  const baseUrl = input.baseUrl ? normalizeBaseUrl(input.baseUrl) : config.baseUrl
  if (input.apiKey) return { baseUrl, apiKey: input.apiKey, model }
  if (baseUrl !== config.baseUrl || !config.apiKey) return null
  return { baseUrl, apiKey: config.apiKey, model }
}

export async function resolveConnection(input: z.infer<typeof connectionSchema>, model?: string): Promise<ProviderConnection> {
  const connection = connectionFor(input, await getAgentConfig(), model)
  if (!connection) throw createError({ statusCode: 400, statusMessage: 'Introduce la clave de este proveedor' })
  return connection
}

export interface ToolTestResult {
  label: string
  ok: boolean
  tool: string | null
  arguments: string | null
  ms: number
  error: string | null
}

const TEST_CASES = [
  { label: 'Consulta', prompt: '¿Cuánto dinero hay ahora en la cuenta del banco?', kinds: ['read'] },
  { label: 'Cambio', prompt: 'Crea una tarea llamada «Revisar el riego» para el 1 de diciembre de 2026.', kinds: ['write', 'destructive'] }
] as const

// Le pide al modelo una consulta y un cambio con las herramientas reales y comprueba que
// elige una herramienta del tipo correcto. No ejecuta nada.
// Los dos casos van en paralelo y con plazo corto: la petición no debe pasar del timeout del proxy.
export async function testToolCalling(connection: ProviderConnection): Promise<ToolTestResult[]> {
  const tools = toChatTools(TOOLS)
  return Promise.all(TEST_CASES.map(async (testCase): Promise<ToolTestResult> => {
    const started = Date.now()
    try {
      const { message } = await chatCompletion([
        { role: 'system', content: 'Eres el asistente de una finca. Usa las herramientas cuando haga falta.' },
        { role: 'user', content: testCase.prompt }
      ], tools, Date.now() + 25_000, connection)
      const call = message.tool_calls?.[0]
      const kind = call ? getTool(call.function.name)?.kind : undefined
      const ok = !!kind && (testCase.kinds as readonly string[]).includes(kind)
      return {
        label: testCase.label,
        ok,
        tool: call?.function.name ?? null,
        arguments: call?.function.arguments?.slice(0, 300) ?? null,
        ms: Date.now() - started,
        error: call ? (ok ? null : 'Eligió una herramienta de otro tipo') : 'No llamó a ninguna herramienta'
      }
    } catch (error) {
      return {
        label: testCase.label,
        ok: false,
        tool: null,
        arguments: null,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : 'Error desconocido'
      }
    }
  }))
}
