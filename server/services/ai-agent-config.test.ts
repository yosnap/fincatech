import { describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from './ai-agent-config'

// La resolución es pura: no hace falta BD ni entorno real.
vi.mock('../db/client', () => ({ db: {} }))
vi.mock('../utils/env', () => ({ getEnv: () => ({}) }))

const { resolveAgentConfig } = await import('./ai-agent-config')

const env = { AI_AGENT_BASE_URL: 'https://api.nan.builders/v1', AI_AGENT_API_KEY: 'env-key-1234', AI_AGENT_MODEL: 'env-model' }
const open = (sealed: string) => (sealed === 'sealed-ok' ? 'db-key-5678' : null)

function row(overrides: Partial<SettingsRow>): SettingsRow {
  return { id: 'global', enabled: true, baseUrl: null, model: null, apiKeyCiphertext: null, apiKeyHint: null, updatedBy: null, updatedAt: new Date(), ...overrides }
}

describe('resolveAgentConfig', () => {
  it('sin ajustes guardados usa el entorno', () => {
    const config = resolveAgentConfig(undefined, env, open)
    expect(config).toMatchObject({ enabled: true, baseUrl: 'https://api.nan.builders/v1', model: 'env-model', apiKey: 'env-key-1234', keySource: 'env' })
  })

  it('los ajustes guardados mandan sobre el entorno', () => {
    const config = resolveAgentConfig(row({ baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKeyCiphertext: 'sealed-ok' }), env, open)
    expect(config).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'db-key-5678', keySource: 'db' })
  })

  it('nunca envía la clave del entorno a otro proveedor', () => {
    const config = resolveAgentConfig(row({ baseUrl: 'https://otro.example/v1' }), env, open)
    expect(config.apiKey).toBeUndefined()
    expect(config.keySource).toBeNull()
  })

  it('usa la clave del entorno si la URL guardada es la misma (con barra final)', () => {
    const config = resolveAgentConfig(row({ baseUrl: 'https://api.nan.builders/v1/' }), env, open)
    expect(config.keySource).toBe('env')
  })

  it('marca la clave guardada ilegible sin caer a la del entorno', () => {
    const config = resolveAgentConfig(row({ apiKeyCiphertext: 'roto', baseUrl: 'https://api.nan.builders/v1' }), env, open)
    expect(config).toMatchObject({ apiKey: undefined, keyUnreadable: true })
  })

  it('respeta el asistente desactivado', () => {
    expect(resolveAgentConfig(row({ enabled: false }), env, open).enabled).toBe(false)
  })
})

describe('clave guardada sin URL guardada', () => {
  it('se ignora y nunca sigue a la URL del entorno', () => {
    const config = resolveAgentConfig(row({ apiKeyCiphertext: 'sealed-ok', baseUrl: null }), env, open)
    expect(config.keySource).toBe('env')
    expect(config.apiKey).toBe('env-key-1234')
  })
})
