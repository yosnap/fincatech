import { createHash } from 'node:crypto'

// El token de /link se guarda hasheado: con acceso a la BD no se puede vincular otro chat.
export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
