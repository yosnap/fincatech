import { z } from 'zod'
import { getExportRows, rowsToCsv } from '../../services/export-service'
import { requireRole } from '../../utils/rbac'

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Parámetros start y end requeridos (YYYY-MM-DD)' })
  }
  if (parsed.data.start > parsed.data.end) {
    throw createError({ statusCode: 400, statusMessage: 'Rango de fechas inválido' })
  }

  const startDate = new Date(parsed.data.start)
  const endDate = new Date(parsed.data.end)
  endDate.setUTCHours(23, 59, 59, 999)

  const rows = await getExportRows(startDate, endDate, actor)
  const csv = rowsToCsv(rows)

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="gastos_${parsed.data.start}_${parsed.data.end}.csv"`)
  return csv
})
