import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkConnection } from '../services/storage'

export default defineEventHandler(async () => {
  const [dbResult, minioResult] = await Promise.allSettled([
    db.execute(sql`select 1`),
    checkConnection()
  ])

  const dbOk = dbResult.status === 'fulfilled'
  const minioOk = minioResult.status === 'fulfilled'

  if (!dbOk || !minioOk) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service unavailable',
      data: { db: dbOk, minio: minioOk }
    })
  }

  return { status: 'ok', db: true, minio: true }
})
