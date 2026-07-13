<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Reservation {
  id: string
  ownerId: string
  startDate: string
  endDate: string
  notes: string | null
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ reservations: Reservation[] }>('/api/reservations')

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canReserve = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

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

async function cancelReservation(id: string) {
  busyId.value = id
  try {
    await $fetch(`/api/reservations/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Reserva cancelada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo cancelar la reserva', color: 'error' })
  } finally {
    busyId.value = null
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
        <h2 class="text-sm font-semibold">
          Reservas
        </h2>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="reservation in data?.reservations ?? []"
          :key="reservation.id"
          class="flex items-center justify-between py-3"
        >
          <div>
            <p class="text-sm font-medium">
              {{ reservation.startDate }} — {{ reservation.endDate }}
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
        <p
          v-if="!(data?.reservations ?? []).length"
          class="py-4 text-center text-sm text-muted"
        >
          Sin reservas
        </p>
      </div>
    </UCard>
  </div>
</template>
