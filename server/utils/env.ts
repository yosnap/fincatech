import { z } from 'zod'

// Algunos PaaS (Easypanel incluido) inyectan una variable "opcional" dejada en blanco en
// el formulario como cadena vacía en vez de omitirla del entorno — `.optional()` de zod
// solo perdona `undefined`, no `''`, así que sin este preprocesado una var opcional vacía
// rompía el arranque igual que si fuera obligatoria. Convierte '' -> undefined antes de
// validar, para las 3 vars que son opcionales a propósito.
const optionalString = () => z.preprocess(v => (v === '' ? undefined : v), z.string().min(1).optional())

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
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
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
