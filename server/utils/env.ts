import { z } from 'zod'

// Algunos PaaS (Easypanel incluido) inyectan una variable "opcional" dejada en blanco en
// el formulario como cadena vacía en vez de omitirla del entorno — `.optional()` de zod
// solo perdona `undefined`, no `''`, así que sin este preprocesado una var opcional vacía
// rompía el arranque igual que si fuera obligatoria. Convierte '' -> undefined antes de
// validar, para las 3 vars que son opcionales a propósito.
const optionalString = () => z.preprocess(v => (v === '' ? undefined : v), z.string().min(1).optional())
const optionalNumber = () => z.preprocess(v => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().positive().optional())

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive(),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform(v => v === 'true'),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  // Opcional a propósito (igual que NAN_BUILDERS_API_KEY/TELEGRAM_*): sin SMTP completo,
  // server/utils/email.ts lanza un error claro y capturable en vez de mandar mail — los dos
  // sitios que envían email (invite.post.ts, notification-service.ts) ya lo capturan y
  // degradan con gracia (invite.post.ts devuelve el token para compartir a mano; el
  // dispatcher de notificaciones marca ese intento 'failed' tras MAX_ATTEMPTS, sin tumbar
  // el resto de canales/notificaciones). No tiene sentido validar los 5 campos por
  // separado como "todos o ninguno" aquí — email.ts ya comprueba el conjunto completo antes
  // de intentar enviar.
  SMTP_HOST: optionalString(),
  SMTP_PORT: optionalNumber(),
  SMTP_USER: optionalString(),
  SMTP_PASS: optionalString(),
  SMTP_FROM: optionalString(),
  // Opcional a propósito: si falta, el OCR (Fase 4) se degrada a 503 -> entrada manual
  // en vez de impedir que arranque toda la app (fail-fast solo aplica a lo imprescindible).
  NAN_BUILDERS_API_KEY: optionalString(),
  // Opcionales igual que NAN_BUILDERS_API_KEY: sin ellas, el bot de Telegram (Fase 5) queda
  // desactivado (el webhook rechaza todo) pero el resto de la app arranca normalmente.
  TELEGRAM_BOT_TOKEN: optionalString(),
  TELEGRAM_WEBHOOK_SECRET: optionalString()
})

let cached: z.infer<typeof envSchema> | undefined

export function getEnv() {
  if (cached) return cached
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`
    )
  }
  cached = parsed.data
  return cached
}
