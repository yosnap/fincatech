import { z } from 'zod'
import { auth } from '../../utils/auth'
import { writeAuditLog } from '../../utils/audit'
import { checkRateLimit } from '../../utils/rate-limit'

// Tope generoso para uso legítimo (una familia no necesita más de un puñado de altas) pero
// suficiente para frenar un script que intente inundar la cola de aprobación de /members.
const SELF_REGISTER_MAX_PER_WINDOW = 5
const SELF_REGISTER_WINDOW_MS = 60 * 60 * 1000

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1)
})

// Auto-registro público con aprobación de Admin: cualquiera puede crear una cuenta, pero
// queda pendingApproval=true SIN acceso de ningún tipo — el hook de sign-in de auth.ts
// rechaza su login hasta que un Admin le suba el rol desde /members (role.patch limpia
// pendingApproval al cambiar el rol). Por eso aquí NO se auto-inicia sesión tras crearla.
// No usa el endpoint público /sign-up/email de Better Auth (disableSignUp sigue en true) —
// llama a auth.api.createUser server-side, igual que accept-invite/bootstrap-admin, para
// controlar exactamente el role y el flag pendingApproval (server-owned, ver auth.ts).
export default defineEventHandler(async (event) => {
  // Las llamadas server-side a auth.api.createUser NO pasan por el router HTTP de Better
  // Auth, así que eluden por completo su rate-limiting integrado — sin este check, este
  // endpoint público quedaría sin ninguna fricción contra un script de creación masiva de
  // cuentas 'guest' pendientes.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkRateLimit(`self-register:${ip}`, { max: SELF_REGISTER_MAX_PER_WINDOW, windowMs: SELF_REGISTER_WINDOW_MS })) {
    throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos de registro. Inténtalo de nuevo más tarde.' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  let userId: string
  try {
    const created = await auth.api.createUser({
      body: {
        email: body.email,
        password: body.password,
        name: body.name,
        role: 'guest',
        data: { pendingApproval: true }
      }
    })
    userId = created.user.id
  } catch (error) {
    console.error('[auth/self-register] fallo creando la cuenta', error)
    throw createError({ statusCode: 400, statusMessage: 'No se pudo crear la cuenta (el email ya podría estar registrado)' })
  }

  await writeAuditLog({
    actorId: null,
    action: 'self_registered',
    entityType: 'user',
    entityId: userId,
    metadata: { email: body.email }
  })

  // Sin auto-inicio de sesión: la cuenta está pendiente de aprobación y el hook de
  // sign-in la rechazaría. El usuario entrará cuando el Admin le asigne rol.
  return { user: { id: userId, email: body.email, name: body.name, role: 'guest' } }
})
