import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { getEnv } from './env'

// Cifrado simétrico de secretos guardados en la BD (p. ej. la clave del proveedor IA).
// AES-256-GCM con una clave derivada (HKDF) de BETTER_AUTH_SECRET: un volcado de la BD no
// basta para leerlos. Si el secreto del servidor cambia, lo cifrado deja de poder abrirse y
// `openSecret` devuelve null (el Admin tendrá que volver a introducir la clave).

const VERSION = 'v1'
const AUTH_TAG_LENGTH = 16

function derivedKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', getEnv().BETTER_AUTH_SECRET, 'fincatech', 'secret-box/v1', 32))
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function openSecret(sealed: string): string | null {
  const [version, iv, tag, ciphertext] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !ciphertext) return null
  const authTag = Buffer.from(tag, 'base64url')
  // Etiqueta completa obligatoria: GCM aceptaría etiquetas truncadas (más fáciles de forjar).
  if (authTag.length !== AUTH_TAG_LENGTH) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(iv, 'base64url'), { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
