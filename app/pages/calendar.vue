<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Reservation {
  id: string
  ownerId: string
  ownerName: string
  startDate: string
  endDate: string
  notes: string | null
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ reservations: Reservation[] }>('/api/reservations')

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canReserve = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

const viewMode = ref<'calendar' | 'list'>('calendar')

// Detalle de reserva desde la vista de calendario: clic en una pastilla del mes.
const selectedReservation = ref<Reservation | null>(null)
const detailOpen = ref(false)

function openDetail(reservation: Reservation) {
  selectedReservation.value = reservation
  detailOpen.value = true
}

function canCancel(reservation: Reservation): boolean {
  return currentUserRole.value === 'admin' || reservation.ownerId === currentUserId.value
}

function statusOf(reservation: Reservation): { label: string, color: 'success' | 'neutral' | 'primary' } {
  if (isOngoing(reservation)) return { label: 'En curso', color: 'success' }
  if (isPast(reservation)) return { label: 'Pasada', color: 'neutral' }
  return { label: 'Próxima', color: 'primary' }
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const todayKey = toKey(new Date())

function isPast(reservation: Reservation): boolean {
  return reservation.endDate < todayKey
}
function isOngoing(reservation: Reservation): boolean {
  return reservation.startDate <= todayKey && todayKey <= reservation.endDate
}

const startDate = ref('')
const endDate = ref('')
const notes = ref('')
const submitting = ref(false)
const busyId = ref<string | null>(null)
const toast = useToast()

async function onSubmit() {
  submitting.value = true
  try {
    await $fetch('/api/reservations', {
      method: 'POST',
      body: { startDate: startDate.value, endDate: endDate.value, notes: notes.value || undefined }
    })
    startDate.value = ''
    endDate.value = ''
    notes.value = ''
    await refresh()
    toast.add({ title: 'Reserva creada', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo crear la reserva', color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function cancelReservation(id: string): Promise<boolean> {
  busyId.value = id
  try {
    await $fetch(`/api/reservations/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Reserva cancelada', color: 'success' })
    return true
  } catch {
    toast.add({ title: 'No se pudo cancelar la reserva', color: 'error' })
    return false
  } finally {
    busyId.value = null
  }
}

async function cancelFromModal() {
  if (!selectedReservation.value) return
  const ok = await cancelReservation(selectedReservation.value.id)
  if (ok) {
    detailOpen.value = false
    selectedReservation.value = null
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Calendario de reservas
    </h1>

    <UCard v-if="canReserve">
      <template #header>
        <h2 class="text-sm font-semibold">
          Nueva reserva
        </h2>
      </template>
      <form
        class="flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <div class="flex flex-col gap-4 sm:flex-row">
          <UFormField
            label="Desde"
            class="flex-1"
          >
            <UInput
              v-model="startDate"
              type="date"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Hasta"
            class="flex-1"
          >
            <UInput
              v-model="endDate"
              type="date"
              required
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="Notas (opcional)">
          <UInput
            v-model="notes"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          :loading="submitting"
        >
          Reservar
        </UButton>
      </form>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">
            Reservas
          </h2>
          <UButtonGroup
            variant="soft"
            size="sm"
          >
            <UButton
              :variant="viewMode === 'calendar' ? 'solid' : 'soft'"
              icon="i-lucide-calendar-days"
              @click="viewMode = 'calendar'"
            >
              Calendario
            </UButton>
            <UButton
              :variant="viewMode === 'list' ? 'solid' : 'soft'"
              icon="i-lucide-list"
              @click="viewMode = 'list'"
            >
              Lista
            </UButton>
          </UButtonGroup>
        </div>
      </template>

      <ReservationCalendar
        v-if="viewMode === 'calendar'"
        :reservations="data?.reservations ?? []"
        @select="openDetail"
      />

      <template v-else-if="(data?.reservations ?? []).length">
        <div class="flex flex-col divide-y divide-default">
          <div
            v-for="reservation in data?.reservations"
            :key="reservation.id"
            class="flex items-center justify-between gap-2 py-3"
            :class="isPast(reservation) ? 'opacity-50' : ''"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium">
                {{ reservation.startDate }} — {{ reservation.endDate }}
                <UBadge
                  v-if="isOngoing(reservation)"
                  color="success"
                  variant="soft"
                  size="sm"
                >
                  En curso
                </UBadge>
                <UBadge
                  v-else-if="isPast(reservation)"
                  variant="subtle"
                  size="sm"
                >
                  Pasada
                </UBadge>
              </p>
              <p class="text-sm text-muted">
                {{ reservation.ownerName }}
              </p>
              <p
                v-if="reservation.notes"
                class="text-sm text-muted"
              >
                {{ reservation.notes }}
              </p>
            </div>
            <UButton
              v-if="currentUserRole === 'admin' || reservation.ownerId === currentUserId"
              size="xs"
              color="error"
              variant="soft"
              :loading="busyId === reservation.id"
              @click="cancelReservation(reservation.id)"
            >
              Cancelar
            </UButton>
          </div>
        </div>
      </template>

      <div
        v-else
        class="flex flex-col items-center gap-2 py-8 text-center"
      >
        <UIcon
          name="i-lucide-calendar-off"
          class="size-6 text-muted"
        />
        <p class="text-sm text-muted">
          No hay reservas
        </p>
      </div>
    </UCard>

    <UModal
      v-model:open="detailOpen"
      :ui="{ content: 'max-w-md' }"
    >
      <template #content>
        <div
          v-if="selectedReservation"
          class="flex flex-col gap-4 p-6"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-lg font-semibold">
                Reserva de {{ selectedReservation.ownerName }}
              </p>
              <UBadge
                :color="statusOf(selectedReservation).color"
                variant="soft"
                size="sm"
                class="mt-1"
              >
                {{ statusOf(selectedReservation).label }}
              </UBadge>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="sm"
              aria-label="Cerrar"
              @click="detailOpen = false"
            />
          </div>

          <dl class="flex flex-col gap-2 text-sm">
            <div class="flex items-center justify-between">
              <dt class="text-muted">
                Desde
              </dt>
              <dd class="font-medium capitalize">
                {{ formatDate(selectedReservation.startDate) }}
              </dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-muted">
                Hasta
              </dt>
              <dd class="font-medium capitalize">
                {{ formatDate(selectedReservation.endDate) }}
              </dd>
            </div>
            <div
              v-if="selectedReservation.notes"
              class="flex flex-col gap-1"
            >
              <dt class="text-muted">
                Notas
              </dt>
              <dd>
                {{ selectedReservation.notes }}
              </dd>
            </div>
          </dl>

          <UButton
            v-if="canCancel(selectedReservation)"
            color="error"
            variant="soft"
            block
            :loading="busyId === selectedReservation.id"
            @click="cancelFromModal"
          >
            Cancelar reserva
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
