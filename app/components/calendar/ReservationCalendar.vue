<script lang="ts">
export interface CalendarReservation {
  id: string
  ownerId: string
  ownerName: string
  startDate: string
  endDate: string
  notes: string | null
}
</script>

<script setup lang="ts">
const props = defineProps<{
  reservations: CalendarReservation[]
}>()

const emit = defineEmits<{
  select: [reservation: CalendarReservation]
}>()

// Clases literales a propósito (Tailwind las detecta escaneando el fuente). Colores fijos
// por persona en orden de primera aparición: la misma reserva pinta igual todos sus días.
const OWNER_COLORS = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-error', 'bg-secondary']

const ownerColorMap = computed(() => {
  const map = new Map<string, string>()
  for (const reservation of props.reservations) {
    if (!map.has(reservation.ownerId)) {
      map.set(reservation.ownerId, OWNER_COLORS[map.size % OWNER_COLORS.length]!)
    }
  }
  return map
})

function colorOf(ownerId: string): string {
  return ownerColorMap.value.get(ownerId) ?? 'bg-neutral'
}

const ownerLegend = computed(() => [...ownerColorMap.value.entries()]
  .map(([ownerId, color]) => ({
    ownerId,
    name: props.reservations.find(r => r.ownerId === ownerId)?.ownerName ?? ownerId,
    color
  })))

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEK_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const todayKey = toKey(new Date())
const viewMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

function shiftMonth(delta: number) {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + delta, 1)
}
function goToday() {
  viewMonth.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
}

const monthLabel = computed(() => `${MONTH_NAMES[viewMonth.value.getMonth()]} ${viewMonth.value.getFullYear()}`)

interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
}

// 42 celdas (6 semanas) para altura estable: relleno con los días del mes anterior y del
// siguiente, atenuados. Semana empezando en lunes (España).
const cells = computed<CalendarCell[]>(() => {
  const year = viewMonth.value.getFullYear()
  const month = viewMonth.value.getMonth()
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7
  const start = new Date(year, month, 1 - firstOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return {
      key: toKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: toKey(date) === todayKey
    }
  })
})

// startDate/endDate son fechas ISO 'YYYY-MM-DD' (mode: 'string'): la comparación
// lexicográfica es equivalente a la temporal y no depende de zonas horarias.
const reservationsByDay = computed(() => {
  const map = new Map<string, CalendarReservation[]>()
  for (const reservation of props.reservations) {
    for (const cell of cells.value) {
      if (cell.key < reservation.startDate || cell.key > reservation.endDate) continue
      const list = map.get(cell.key) ?? []
      list.push(reservation)
      map.set(cell.key, list)
    }
  }
  return map
})

function chipsOf(cell: CalendarCell): CalendarReservation[] {
  return reservationsByDay.value.get(cell.key) ?? []
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <UButton
        icon="i-lucide-chevron-left"
        variant="ghost"
        size="sm"
        aria-label="Mes anterior"
        @click="shiftMonth(-1)"
      />
      <div class="flex items-center gap-2">
        <p class="text-sm font-semibold capitalize">
          {{ monthLabel }}
        </p>
        <UButton
          variant="soft"
          size="xs"
          @click="goToday"
        >
          Hoy
        </UButton>
      </div>
      <UButton
        icon="i-lucide-chevron-right"
        variant="ghost"
        size="sm"
        aria-label="Mes siguiente"
        @click="shiftMonth(1)"
      />
    </div>

    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
      <p
        v-for="day in WEEK_DAYS"
        :key="day"
      >
        {{ day }}
      </p>
    </div>

    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="cell in cells"
        :key="cell.key"
        class="flex h-20 flex-col gap-1 rounded-md border border-default p-1 sm:h-24"
        :class="cell.inMonth ? '' : 'opacity-40'"
      >
        <p
          class="text-xs"
          :class="cell.isToday ? 'font-bold text-primary' : 'text-muted'"
        >
          {{ cell.day }}
        </p>
        <div
          v-for="reservation in chipsOf(cell)"
          :key="reservation.id"
          class="min-w-0"
        >
          <button
            v-if="reservation.startDate === cell.key"
            type="button"
            class="w-full cursor-pointer truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight text-inverted transition-opacity hover:opacity-80"
            :class="colorOf(reservation.ownerId)"
            :title="`${reservation.ownerName}: ${reservation.startDate} — ${reservation.endDate}`"
            :aria-label="`Reserva de ${reservation.ownerName}, del ${reservation.startDate} al ${reservation.endDate}. Ver detalles`"
            @click="emit('select', reservation)"
          >
            {{ reservation.ownerName }}
          </button>
          <button
            v-else
            type="button"
            class="block h-2 w-full cursor-pointer rounded transition-opacity hover:opacity-80"
            :class="colorOf(reservation.ownerId)"
            :aria-label="`Reserva de ${reservation.ownerName} (continúa). Ver detalles`"
            @click="emit('select', reservation)"
          />
        </div>
      </div>
    </div>

    <div
      v-if="ownerLegend.length"
      class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
    >
      <span
        v-for="legend in ownerLegend"
        :key="legend.ownerId"
        class="inline-flex items-center gap-1"
      >
        <span
          class="size-2 rounded-full"
          :class="legend.color"
        />
        {{ legend.name }}
      </span>
    </div>
  </div>
</template>
