import nodemailer from 'nodemailer'
import { getEnv } from './env'

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined

function getTransporter() {
  if (transporter) return transporter
  const env = getEnv()
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  })
  return transporter
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  owner: 'Propietario',
  guest: 'Invitado'
}

export async function sendInvitationEmail(to: string, token: string, role: string) {
  const env = getEnv()
  const acceptUrl = new URL('/accept-invite', env.BETTER_AUTH_URL)
  acceptUrl.searchParams.set('token', token)
  const roleLabel = ROLE_LABELS[role] ?? role

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Invitación a Finca La Unión',
    html: `
      <p>Te han invitado a unirte a la plataforma de gestión de Finca La Unión como <strong>${roleLabel}</strong>.</p>
      <p><a href="${acceptUrl.toString()}">Aceptar invitación</a></p>
      <p>Este enlace caduca en 48 horas y solo puede usarse una vez.</p>
    `
  })
}
