import nodemailer from 'nodemailer'
import { getEnv } from './env'

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined

// Único punto que valida el conjunto completo de credenciales SMTP y narrowea los tipos
// (opcionales en env.ts) a valores garantizados — evita repetir el check en cada función.
function requireEmailConfig() {
  const env = getEnv()
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) {
    throw new Error('SMTP no configurado — configura SMTP_HOST/PORT/USER/PASS/FROM para enviar email')
  }
  return { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM }
}

function getTransporter(config: ReturnType<typeof requireEmailConfig>) {
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass }
  })
  return transporter
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  owner: 'Propietario',
  guest: 'Invitado'
}

export async function sendEmail(to: string, subject: string, html: string) {
  const config = requireEmailConfig()
  await getTransporter(config).sendMail({ from: config.from, to, subject, html })
}

export async function sendInvitationEmail(to: string, token: string, role: string) {
  const config = requireEmailConfig()
  const acceptUrl = new URL('/accept-invite', getEnv().BETTER_AUTH_URL)
  acceptUrl.searchParams.set('token', token)
  const roleLabel = ROLE_LABELS[role] ?? role

  await getTransporter(config).sendMail({
    from: config.from,
    to,
    subject: 'Invitación a Finca La Unión',
    html: `
      <p>Te han invitado a unirte a la plataforma de gestión de Finca La Unión como <strong>${roleLabel}</strong>.</p>
      <p><a href="${acceptUrl.toString()}">Aceptar invitación</a></p>
      <p>Este enlace caduca en 48 horas y solo puede usarse una vez.</p>
    `
  })
}
