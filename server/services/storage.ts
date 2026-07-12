import { Client } from 'minio'
import { getEnv } from '../utils/env'

let client: Client | undefined

function getClient() {
  if (client) return client
  const env = getEnv()
  client = new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY
  })
  return client
}

async function ensureBucket() {
  const env = getEnv()
  const c = getClient()
  const exists = await c.bucketExists(env.MINIO_BUCKET).catch(() => false)
  if (!exists) await c.makeBucket(env.MINIO_BUCKET)
}

export async function uploadFile(objectName: string, buffer: Buffer, contentType: string) {
  const env = getEnv()
  await ensureBucket()
  await getClient().putObject(env.MINIO_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': contentType
  })
  return objectName
}

export async function getSignedUrl(objectName: string, expirySeconds = 300) {
  const env = getEnv()
  return getClient().presignedGetObject(env.MINIO_BUCKET, objectName, expirySeconds)
}

export async function deleteFile(objectName: string) {
  const env = getEnv()
  await getClient().removeObject(env.MINIO_BUCKET, objectName)
}

export async function checkConnection() {
  const env = getEnv()
  await getClient().bucketExists(env.MINIO_BUCKET)
}
