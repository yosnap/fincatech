import { describe } from 'vitest'

// Utilidades para los tests de integración contra Postgres REAL. El resto de la suite prueba
// funciones puras; estos tests existen porque el comportamiento de la papelera y de los
// locks solo se puede demostrar con conexiones de verdad.
//
// Se activan con TEST_DATABASE_URL (una BD con las migraciones aplicadas); sin ella el bloque
// queda 'skipped' y `pnpm test` sigue siendo puro:
//   TEST_DATABASE_URL=postgres://fincatech:fincatech@localhost:5438/fincatech pnpm test

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

export const describeDb = TEST_DATABASE_URL ? describe : describe.skip

// getEnv() valida TODAS las variables al importar el cliente de DB; en el proceso de vitest
// solo hace falta la conexión, así que se rellenan los mínimos con valores locales de test
// ANTES de importar el cliente (por eso el import es dinámico).
export async function setupIntegrationDb() {
  if (!TEST_DATABASE_URL) {
    throw new Error('setupIntegrationDb() requiere TEST_DATABASE_URL')
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.MINIO_ENDPOINT ??= 'localhost'
  process.env.MINIO_PORT ??= '9000'
  process.env.MINIO_ACCESS_KEY ??= 'test'
  process.env.MINIO_SECRET_KEY ??= 'test'
  process.env.MINIO_BUCKET ??= 'test'
  process.env.BETTER_AUTH_SECRET ??= '0123456789abcdef0123456789abcdef'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'

  const client = await import('../db/client')
  const schema = await import('../db/schema')
  return { ...client, schema }
}

// Sufijo único por ejecución para no chocar con datos reales de la BD de desarrollo.
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
