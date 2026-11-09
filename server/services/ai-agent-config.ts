import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { aiAgentSettings } from '../db/schema'
import { getEnv } from '../utils/env'
import { openSecret } from '../utils/secret-box'

// Configuración efectiva del asistente IA: lo que el Admin guarda en la web manda; lo que no
// haya guardado cae a las variables de entorno.
//
// Regla de la clave: una clave solo viaja al proveedor con el que se configuró. La del entorno
// solo se usa con AI_AGENT_BASE_URL del entorno, y la guardada en la BD solo con la URL
// guardada junto a ella (cambiar la URL desde la web borra la clave guardada). Así, cambiar el
// proveedor nunca envía una clave existente a un servidor nuevo.

export const SETTINGS_ID = 'global'
const CACHE_TTL_MS = 30_000

export type SettingsRow = typeof aiAgentSettings.$inferSelect

export type KeySource = 'db' | 'env' | null

export interface AgentConfig {
  enabled: boolean
  baseUrl: string
  model: string | undefined
  apiKey: string | undefined
  keySource: KeySource
  // Hay una clave guardada que no se puede descifrar (cambió BETTER_AUTH_SECRET).
  keyUnreadable: boolean
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

interface EnvLike {
  AI_AGENT_BASE_URL: string
  AI_AGENT_API_KEY?: string
  NAN_BUILDERS_API_KEY?: string
  AI_AGENT_MODEL?: string
}

export function envApiKey(env: EnvLike): string | undefined {
  return env.AI_AGENT_API_KEY ?? env.NAN_BUILDERS_API_KEY
}

// Pura (sin BD ni entorno global) para poder probarla.
export function resolveAgentConfig(row: SettingsRow | undefined, env: EnvLike, open = openSecret): AgentConfig {
  const baseUrl = normalizeBaseUrl(row?.baseUrl ?? env.AI_AGENT_BASE_URL)
  let apiKey: string | undefined
  let keySource: KeySource = null
  let keyUnreadable = false

  // Una clave guardada siempre va emparejada con su URL guardada; sin ella se ignora (nunca
  // seguiría a una URL del entorno que cambie después).
  if (row?.apiKeyCiphertext && row.baseUrl) {
    const opened = open(row.apiKeyCiphertext)
    if (opened) {
      apiKey = opened
      keySource = 'db'
    } else {
      keyUnreadable = true
    }
  } else if (baseUrl === normalizeBaseUrl(env.AI_AGENT_BASE_URL) && envApiKey(env)) {
    apiKey = envApiKey(env)
    keySource = 'env'
  }

  return {
    enabled: row ? row.enabled : true,
    baseUrl,
    model: row?.model ?? env.AI_AGENT_MODEL,
    apiKey,
    keySource,
    keyUnreadable
  }
}

let cache: { row: SettingsRow | undefined, at: number } | undefined
// Sube en cada invalidación: una lectura que empezó antes de un guardado no repuebla la caché
// con la fila antigua.
let generation = 0

export async function loadSettingsRow(): Promise<SettingsRow | undefined> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.row
  const startedAt = generation
  const row = await db.query.aiAgentSettings.findFirst({ where: eq(aiAgentSettings.id, SETTINGS_ID) })
  if (startedAt === generation) cache = { row, at: Date.now() }
  return row
}

export function invalidateAgentConfigCache() {
  generation++
  cache = undefined
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return resolveAgentConfig(await loadSettingsRow(), getEnv())
}

export function isConfigUsable(config: AgentConfig): boolean {
  return config.enabled && !!config.model && !!config.apiKey
}

export interface ProviderConnection {
  baseUrl: string
  apiKey: string
  model?: string
}

// Conexión lista para usar, o null si el asistente está desactivado o incompleto.
export function connectionFromConfig(config: AgentConfig): ProviderConnection | null {
  if (!isConfigUsable(config)) return null
  return { baseUrl: config.baseUrl, apiKey: config.apiKey!, model: config.model }
}

export async function getAgentConnection(): Promise<ProviderConnection | null> {
  return connectionFromConfig(await getAgentConfig())
}
