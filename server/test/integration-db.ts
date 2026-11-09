import { describe } from 'vitest'

// Utilidades para los tests de integración contra Postgres REAL. El resto de la suite prueba
// funciones puras; estos tests existen porque el comportamiento de la papelera y de los
// locks solo se puede demostrar con conexiones de verdad.
//
// Se activan con TEST_DATABASE_URL, que debe apuntar a una BD SOLO de tests (con las
// migraciones aplicadas): algunos tests vacían tablas enteras (p. ej. la hipoteca). Sin ella el
// bloque queda 'skipped' y `pnpm test` sigue siendo puro. Ver docs/deployment.md.

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

export const describeDb = TEST_DATABASE_URL ? describe : describe.skip

// getEnv() valida TODAS las variables al importar el cliente de DB; en el proceso de vitest
// solo hace falta la conexión, así que se rellenan los mínimos con valores locales de test
// ANTES de importar el cliente (por eso el import es dinámico).
export async function setupIntegrationDb() {
  if (!TEST_DATABASE_URL) {
    throw new Error('setupIntegrationDb() requiere TEST_DATABASE_URL')
  }
  // Salvaguarda: nunca contra la BD de desarrollo o producción. El nombre debe acabar en _test.
  const databaseName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '')
  if (!databaseName.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL debe apuntar a una BD cuyo nombre acabe en _test (es «${databaseName}»)`)
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

// Sufijo único por ejecución para que varias ejecuciones no choquen entre sí.
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
