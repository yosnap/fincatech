import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { auth } from '../../utils/auth'
import { writeAuditLog } from '../../utils/audit'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1)
})

// Clave arbitraria fija para el advisory lock de Postgres (serializa bootstraps concurrentes).
const BOOTSTRAP_LOCK_KEY = 872634001

// Ventana de bootstrap: solo funciona mientras no exista ningún usuario todavía.
// En cuanto se crea el primer Admin, este endpoint queda permanentemente inutilizable
// (no es un signup público — disableSignUp sigue activo para /sign-up/email).
export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  // pg_advisory_xact_lock serializa dos requests de bootstrap concurrentes: el segundo
  // espera a que el primero termine (crea el admin y libera el lock al hacer commit)
  // y entonces ve el usuario ya creado y aborta. Sin esto, dos requests simultáneas
  // podrían pasar ambas el check "no existe ningún usuario" y crear dos admins.
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`)

    const existing = await tx.query.users.findFirst()
    if (existing) {
      throw createError({ statusCode: 403, statusMessage: 'Ya existe al menos un usuario; usa invitaciones' })
    }

    return auth.api.createUser({
      body: { email: body.email, password: body.password, name: body.name, role: 'admin' }
    })
  })

  await writeAuditLog({
    actorId: null,
    action: 'admin_bootstrap',
    entityType: 'user',
    entityId: created.user.id,
    metadata: { email: body.email }
  })

  try {
    const { headers } = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      returnHeaders: true
    })
    for (const cookie of headers.getSetCookie()) {
      appendResponseHeader(event, 'set-cookie', cookie)
    }
  } catch {
    // La cuenta se creó igualmente; el usuario puede iniciar sesión manualmente en /login.
  }

  return { user: { id: created.user.id, email: body.email, name: body.name, role: 'admin' } }
})
