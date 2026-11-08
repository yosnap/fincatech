import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock ANTES del import dinámico del registry: la herramienta `listar_duplicados_aportes`
// delega en el servicio real, y no queremos tocar la BD desde un test de unidad.
vi.mock('../services/contribution-service', () => ({
  listPossibleDuplicates: vi.fn(async () => [])
}))

// getEnv() valida el entorno al importar el cliente de DB (cadena del registry → tools →
// servicios → db/client), así que se rellenan los mínimos antes de cargar el módulo.
// DATABASE_URL no se conecta nunca en estos tests: solo se crea el pool.
process.env.DATABASE_URL ??= 'postgres://fincatech:fincatech@localhost:5438/fincatech'
process.env.MINIO_ENDPOINT ??= 'localhost'
process.env.MINIO_PORT ??= '9000'
process.env.MINIO_ACCESS_KEY ??= 'test'
process.env.MINIO_SECRET_KEY ??= 'test'
process.env.MINIO_BUCKET ??= 'test'
process.env.BETTER_AUTH_SECRET ??= '0123456789abcdef0123456789abcdef'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3017'

const { listPossibleDuplicates } = await import('../services/contribution-service')
const { TOOLS, getTool, runTool } = await import('./registry')

const admin = { id: 'admin-1', role: 'admin', banned: false }
const guest = { id: 'guest-1', role: 'guest', banned: false }

describe('registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publica el registro único de herramientas (nombre + schema + kind por cada una)', () => {
    expect(TOOLS.length).toBeGreaterThan(10)
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z0-9_]+$/)
      expect(tool.description.length).toBeGreaterThan(10)
      expect(['read', 'write', 'destructive']).toContain(tool.kind)
      expect(() => tool.inputSchema.safeParse({})).not.toThrow()
    }
    expect(getTool('listar_aportes')).toBeDefined()
  })

  it('no publica el borrado definitivo de la papelera (solo se hace desde la web)', () => {
    expect(TOOLS.filter(tool => tool.name.endsWith('_definitivo'))).toEqual([])
    expect(getTool('restaurar_aporte')).toBeDefined()
  })

  it('rechaza a un actor sin sesión', async () => {
    const result = await runTool(null, 'listar_aportes', {}, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Solo un administrador activo puede usar esta herramienta')
    expect(listPossibleDuplicates).not.toHaveBeenCalled()
  })

  it('rechaza a un no-admin (guest) aunque la herramienta sea de solo lectura', async () => {
    const result = await runTool(guest, 'listar_aportes', {}, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Solo un administrador activo puede usar esta herramienta')
  })

  it('rechaza a un admin dado de baja', async () => {
    const result = await runTool({ ...admin, banned: true }, 'listar_aportes', {}, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Solo un administrador activo puede usar esta herramienta')
  })

  it('devuelve un error legible para una herramienta inexistente', async () => {
    const result = await runTool(admin, 'no_existe', {}, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Herramienta desconocida: no_existe')
  })

  it('valida la entrada con zod antes de llamar al servicio', async () => {
    const result = await runTool(admin, 'eliminar_aporte', { id: 'no-es-uuid' }, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Entrada inválida')
  })

  it('ejecuta una herramienta de lectura como admin y devuelve el resultado', async () => {
    const result = await runTool(admin, 'listar_duplicados_aportes', {}, 'mcp')
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ grupos: [] })
    expect(listPossibleDuplicates).toHaveBeenCalledTimes(1)
  })

  it('traduce el error de negocio a un mensaje legible con su código', async () => {
    vi.mocked(listPossibleDuplicates).mockRejectedValueOnce(
      Object.assign(new Error('conflicto'), { statusCode: 409, statusMessage: 'Posible duplicado', data: { code: 'possible_duplicate' } })
    )
    const result = await runTool(admin, 'listar_duplicados_aportes', {}, 'mcp')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Posible duplicado')
    expect(result.code).toBe('possible_duplicate')
  })
})
