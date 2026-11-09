import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createContribution } from '../../../services/contribution-service'
import { deleteFile, uploadFile } from '../../../services/storage'
import { matchesDeclaredType } from '../../../utils/file-signature'
import { requireRole } from '../../../utils/rbac'
import { createContributionSchema } from '../../../validation/finance'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024
// Tope defensivo muy por encima de cualquier aporte real: integer de Postgres (int4) muere
// por encima de ~21,4M€ con un 500 feo — mejor un 400 claro.
// Multipart: los campos llegan como texto. El esquema de negocio es el compartido con el
// servidor MCP (`server/validation/finance.ts`); `force` es exclusivo de la web (RT-6): el bot
// y el MCP reciben el 409 de posible duplicado como información, nunca un botón de saltarlo.
const rawFieldsSchema = z.object({
  memberId: z.string().min(1),
  amountCents: z.coerce.number(),
  type: z.string(),
  period: z.string().optional(),
  method: z.string(),
  date: z.string(),
  months: z.coerce.number().optional(),
  notes: z.string().optional(),
  force: z.enum(['true', 'false']).optional()
})

// Registro de aporte: opción A (cada miembro registra la suya) u opción B (el Admin
// registra por otra persona → queda marcado en registeredBy). Sin Invitados: un aporte
// siempre pertenece a un miembro activo (admin/owner) y el servicio lo exige — mejor el
// 403 claro aquí que el 400 confuso de "miembro inválido" del servicio. Multipart porque
// una transferencia puede llevar el justificante del ticket bancario, que se adjunta al
// MOVIMIENTO auto-creado — el aporte en efectivo no lleva archivo (lo trae su depósito
// al vincularlo), por eso el file solo se acepta con method='transfer'.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const formData = await readMultipartFormData(event)
  const rawFields: Record<string, string> = {}
  for (const part of formData ?? []) {
    if (part.name && part.name !== 'proof') rawFields[part.name] = Buffer.from(part.data).toString('utf8')
  }
  const raw = rawFieldsSchema.safeParse(rawFields)
  if (!raw.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: raw.error.flatten() })
  }
  const parsed = createContributionSchema.safeParse({
    ...raw.data,
    period: raw.data.period ?? null
  })
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data
  const force = raw.data.force === 'true'

  const file = formData?.find(part => part.name === 'proof')
  if (file && body.method !== 'transfer') {
    throw createError({ statusCode: 400, statusMessage: 'Solo los aportes por transferencia llevan justificante' })
  }

  let proof: { objectName: string, contentType: string } | undefined
  if (file?.type && file.type !== 'application/octet-stream') {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'Justificante inválido (JPEG, PNG o PDF)' })
    }
    const buffer = Buffer.from(file.data)
    if (buffer.length > MAX_SIZE_BYTES) {
      throw createError({ statusCode: 400, statusMessage: 'El justificante supera el límite de 10MB' })
    }
    if (!matchesDeclaredType(buffer, file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
    }
    const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
    const objectName = `bank/transactions/${randomUUID()}.${extension}`
    try {
      await uploadFile(objectName, buffer, file.type)
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo subir el justificante' })
    }
    proof = { objectName, contentType: file.type }
  }

  try {
    const result = await createContribution({
      actorId: actor.id,
      actorRole: actor.role,
      memberId: body.memberId,
      amountCents: body.amountCents,
      type: body.type,
      period: body.period ?? null,
      method: body.method,
      date: body.date,
      months: body.months,
      notes: body.notes ?? null,
      proof,
      force
    })
    return result
  } catch (error) {
    // La transacción de DB falló (p. ej. cuota duplicada): el objeto subido queda huérfano.
    if (proof) await deleteFile(proof.objectName).catch(() => null)
    throw error
  }
})
