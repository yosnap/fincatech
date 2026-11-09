import { describe, expect, it, vi } from 'vitest'
import type { AgentConfig, SettingsRow } from './ai-agent-config'

// Reglas puras de guardado y conexión: sin BD ni entorno real.
vi.mock('../db/client', () => ({ db: {} }))
vi.mock('../utils/env', () => ({ getEnv: () => ({}) }))
vi.mock('../tools/registry', () => ({ TOOLS: [], getTool: () => undefined }))

const { computeStoredValues, connectionFor, isAllowedBaseUrl } = await import('./ai-agent-settings')

const env = { AI_AGENT_BASE_URL: 'https://api.nan.builders/v1', AI_AGENT_MODEL: 'env-model' }
const seal = (plain: string) => `sealed:${plain}`

function row(overrides: Partial<SettingsRow>): SettingsRow {
  return { id: 'global', enabled: true, baseUrl: null, model: null, apiKeyCiphertext: null, apiKeyHint: null, updatedBy: null, updatedAt: new Date(), ...overrides }
}

function config(overrides: Partial<AgentConfig>): AgentConfig {
  return { enabled: true, baseUrl: 'https://api.nan.builders/v1', model: 'm', apiKey: 'stored-key', keySource: 'db', keyUnreadable: false, ...overrides }
}

describe('computeStoredValues', () => {
  it('guarda null en lo que coincide con el entorno (no lo congela)', () => {
    const values = computeStoredValues({ enabled: false, baseUrl: 'https://api.nan.builders/v1/', model: 'env-model' }, undefined, env, seal)
    expect(values).toEqual({ enabled: false, baseUrl: null, model: null, apiKeyCiphertext: null, apiKeyHint: null })
  })

  it('con clave nueva guarda la URL explícita junto a la clave cifrada', () => {
    const values = computeStoredValues({ enabled: true, baseUrl: 'https://api.nan.builders/v1', model: 'otro', apiKey: 'sk-nueva-abcd' }, undefined, env, seal)
    expect(values).toMatchObject({ baseUrl: 'https://api.nan.builders/v1', model: 'otro', apiKeyCiphertext: 'sealed:sk-nueva-abcd', apiKeyHint: 'abcd' })
  })

  it('cambiar de proveedor sin clave nueva borra la clave guardada', () => {
    const current = row({ baseUrl: 'https://openrouter.ai/api/v1', apiKeyCiphertext: 'sealed:vieja', apiKeyHint: 'ieja' })
    const values = computeStoredValues({ enabled: true, baseUrl: 'https://otro.example/v1', model: 'm' }, current, env, seal)
    expect(values).toMatchObject({ baseUrl: 'https://otro.example/v1', apiKeyCiphertext: null, apiKeyHint: null })
  })

  it('mismo proveedor sin clave nueva conserva la guardada', () => {
    const current = row({ baseUrl: 'https://openrouter.ai/api/v1', apiKeyCiphertext: 'sealed:vieja', apiKeyHint: 'ieja' })
    const values = computeStoredValues({ enabled: true, baseUrl: 'https://openrouter.ai/api/v1', model: 'm' }, current, env, seal)
    expect(values).toMatchObject({ apiKeyCiphertext: 'sealed:vieja', apiKeyHint: 'ieja' })
  })

  it('clearApiKey borra la clave', () => {
    const current = row({ baseUrl: 'https://openrouter.ai/api/v1', apiKeyCiphertext: 'sealed:vieja' })
    const values = computeStoredValues({ enabled: true, baseUrl: 'https://openrouter.ai/api/v1', model: 'm', clearApiKey: true }, current, env, seal)
    expect(values.apiKeyCiphertext).toBeNull()
  })
})

describe('connectionFor', () => {
  it('sin clave nueva solo usa la efectiva con su propio proveedor', () => {
    expect(connectionFor({}, config({}), 'x')).toEqual({ baseUrl: 'https://api.nan.builders/v1', apiKey: 'stored-key', model: 'x' })
    expect(connectionFor({ baseUrl: 'https://evil.example/v1' }, config({}))).toBeNull()
  })

  it('con clave nueva la usa con la URL indicada', () => {
    expect(connectionFor({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-nueva-1234' }, config({}))?.apiKey).toBe('sk-nueva-1234')
  })

  it('sin clave efectiva pide una', () => {
    expect(connectionFor({}, config({ apiKey: undefined }))).toBeNull()
  })
})

describe('isAllowedBaseUrl', () => {
  it('exige https sin credenciales, query ni fragmento', () => {
    expect(isAllowedBaseUrl('https://api.nan.builders/v1')).toBe(true)
    expect(isAllowedBaseUrl('ftp://x.example')).toBe(false)
    expect(isAllowedBaseUrl('https://user:pass@x.example')).toBe(false)
    expect(isAllowedBaseUrl('https://x.example/v1?key=abc')).toBe(false)
    expect(isAllowedBaseUrl('https://x.example/v1#k')).toBe(false)
  })
})
