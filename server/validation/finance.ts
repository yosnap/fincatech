import { z } from 'zod'
import { isValidCalendarDate, isValidPeriod } from '../services/bank-core'

// Esquemas y topes compartidos por los endpoints y las herramientas del servidor MCP
// (RT-3): la regla tiene que ser LA MISMA por los dos caminos, así que vive aquí y no en el
// handler. Los endpoints siguen validando igual que antes — solo cambia de dónde importan.

// Tope defensivo muy por encima de cualquier importe real: integer de Postgres (int4) muere
// por encima de ~21,4M€ con un 500 feo — mejor un 400 claro.
export const MAX_AMOUNT_CENTS = 100_000_000

export const amountCentsSchema = z.number().int().positive().max(MAX_AMOUNT_CENTS)

// 'YYYY-MM-DD' con fecha de calendario real (rechaza 2026-02-31).
export const calendarDateSchema = z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida')

// 'YYYY-MM' de una cuota.
export const periodSchema = z.string().refine(isValidPeriod, 'Período inválido (YYYY-MM)')

export const BANK_DIRECTION_VALUES = ['deposit', 'withdrawal'] as const
export const EXTERNAL_CATEGORY_VALUES = ['hacienda', 'ayuntamiento', 'impuestos', 'iva', 'otro'] as const

export const bankDirectionSchema = z.enum(BANK_DIRECTION_VALUES)
export const externalCategorySchema = z.enum(EXTERNAL_CATEGORY_VALUES)

// Cuerpo común de alta/edición de movimiento bancario: las salidas no llevan categoría (una
// categoría es un ingreso externo, no de un miembro).
export const bankTransactionFieldsSchema = z.object({
  date: calendarDateSchema,
  direction: bankDirectionSchema,
  amountCents: amountCentsSchema,
  description: z.string().min(1),
  category: externalCategorySchema.nullable()
}).refine(body => body.direction === 'deposit' || body.category === null, {
  message: 'Las salidas no llevan categoría',
  path: ['category']
})

export const CONTRIBUTION_TYPE_VALUES = ['pre_purchase', 'quota', 'extraordinary'] as const
export const CONTRIBUTION_METHOD_VALUES = ['cash', 'transfer'] as const

export const contributionTypeSchema = z.enum(CONTRIBUTION_TYPE_VALUES)
export const contributionMethodSchema = z.enum(CONTRIBUTION_METHOD_VALUES)

// Alta de aporte. `force` NO forma parte de este esquema (RT-6): el 409 de posible duplicado
// se devuelve al modelo como información y solo la web puede reintentar con `force` (por eso
// el endpoint añade ese campo en el suyo).
export const createContributionSchema = z.object({
  memberId: z.string().min(1),
  amountCents: amountCentsSchema,
  type: contributionTypeSchema,
  period: periodSchema.nullable().optional(),
  method: contributionMethodSchema,
  date: calendarDateSchema,
  // Solo cuota: adelanto multi-mes (1-24 filas consecutivas en una transacción).
  months: z.number().int().min(1).max(24).optional(),
  notes: z.string().max(1000).nullable().optional()
}).refine(body => body.type === 'quota' || body.period == null, {
  message: 'Solo las cuotas mensuales llevan período',
  path: ['period']
}).refine(body => body.type !== 'quota' || !!body.period, {
  message: 'La cuota requiere un período (YYYY-MM)',
  path: ['period']
})

export const updateContributionSchema = z.object({
  notes: z.string().max(1000).nullable().optional(),
  date: calendarDateSchema.optional(),
  amountCents: amountCentsSchema.optional(),
  type: contributionTypeSchema.optional(),
  period: periodSchema.nullable().optional()
}).refine(body => Object.keys(body).length > 0, { message: 'No hay cambios que aplicar' })
