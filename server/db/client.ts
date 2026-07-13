import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '../utils/env'
import * as schema from './schema'

const pool = new Pool({ connectionString: getEnv().DATABASE_URL })

export const db = drizzle(pool, { schema })

// Superficie mínima compartida por `db` y por el `tx` de `db.transaction(...)` — permite que
// servicios como proposal-service/assessment-service acepten un executor externo (para
// componerse dentro de UNA sola transacción) sin acoplarse al tipo exacto de la transacción.
export type TxExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'query'>
