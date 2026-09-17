<script setup lang="ts">
// Grid miembro×mes de cuotas: filas = miembros activos, columnas = meses desde
// quotaStartMonth. Celdas: pagado (check), pendiente (vacía, clicable para registrar) y
// adelantada (mes futuro ya pagado por adelanto multi-mes). Scroll horizontal acotado
// (permitido en tablas) cuando pasan de ~24 meses.

interface QuotaContribution {
  id: string
  memberId: string
  period: string | null
}

interface QuotaCellState {
  memberId: string
  contribution: QuotaContribution | null
}

interface QuotaMonthState {
  period: string
  isFuture: boolean
  cells: QuotaCellState[]
}

interface Member {
  id: string
  name: string
}

const props = defineProps<{
  members: Member[]
  months: QuotaMonthState[]
  canRegister: boolean
}>()

const emit = defineEmits<{
  register: [memberId: string, period: string]
}>()

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function monthLabel(period: string): string {
  const [year, month] = period.split('-')
  return `${MONTH_LABELS[Number(month) - 1]!} ${year!.slice(2)}`
}

function cellOf(month: QuotaMonthState, memberId: string): QuotaCellState | undefined {
  return month.cells.find(c => c.memberId === memberId)
}

// Solo los meses ya vencidos se registran clicando la celda: los futuros se cubren con el
// adelanto multi-mes del formulario.
function onCellClick(month: QuotaMonthState, cell: QuotaCellState) {
  if (!props.canRegister || month.isFuture || cell.contribution) return
  emit('register', cell.memberId, month.period)
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-sm font-semibold">
        Cuotas mensuales por miembro
      </h2>
    </template>

    <div class="overflow-x-auto">
      <table class="w-full min-w-max text-sm">
        <thead>
          <tr class="border-b border-default text-left text-muted">
            <th class="sticky left-0 bg-default pr-4 pb-2 font-medium">
              Miembro
            </th>
            <th
              v-for="month in months"
              :key="month.period"
              class="px-2 pb-2 text-center font-medium whitespace-nowrap"
              :class="month.isFuture ? 'text-dimmed' : ''"
            >
              {{ monthLabel(month.period) }}
              <span
                v-if="month.isFuture"
                class="ml-0.5 text-xs"
                title="Mes futuro pagado por adelanto"
              >↷</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="member in members"
            :key="member.id"
            class="border-b border-default last:border-0"
          >
            <td class="sticky left-0 bg-default py-2 pr-4 font-medium whitespace-nowrap">
              {{ member.name }}
            </td>
            <td
              v-for="month in months"
              :key="month.period"
              class="px-2 py-2 text-center"
            >
              <button
                v-if="cellOf(month, member.id)?.contribution"
                type="button"
                class="inline-flex size-6 items-center justify-center rounded-full bg-success/15 text-success"
                title="Cuota pagada"
                aria-label="Cuota pagada"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-4"
                />
              </button>
              <button
                v-else-if="!month.isFuture && canRegister"
                type="button"
                class="inline-flex size-6 items-center justify-center rounded-full bg-muted/40 text-dimmed transition hover:bg-primary/15 hover:text-primary"
                title="Registrar cuota"
                aria-label="Registrar cuota de este mes"
                @click="onCellClick(month, cellOf(month, member.id)!)"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-3.5"
                />
              </button>
              <span
                v-else
                class="inline-flex size-6 items-center justify-center text-dimmed"
                title="Pendiente"
              >·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="!months.length"
      class="py-4 text-center text-muted"
    >
      Aún no hay mes de inicio de cuotas configurado (pídele al Admin que lo fije en
      Cuenta bancaria → Configuración).
    </p>
  </UCard>
</template>
