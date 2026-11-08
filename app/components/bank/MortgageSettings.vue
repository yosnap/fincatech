<script setup lang="ts">
// Configuración de la hipoteca (solo Admin, fase 7): tramos «a partir de este mes, este importe
// y este día de cargo». Cambiar o borrar un tramo NO reescribe los cargos ya creados: el importe
// de un mes es el del tramo vigente en ese mes.

interface ScheduleEntry {
  id: string
  amountCents: number
  chargeDay: number
  effectiveFrom: string
  createdBy: string
  createdAt: string
}

interface MortgageCharge {
  id: string
  month: string
  date: string
  amountCents: number
  deletedAt: string | null
}

interface MortgageOverview {
  schedule: ScheduleEntry[]
  generatedThrough: string | null
  charges: MortgageCharge[]
}

const emit = defineEmits<{ changed: [] }>()

const open = defineModel<boolean>('open', { default: false })

const overview = ref<MortgageOverview | null>(null)
const loading = ref(false)
const submitting = ref(false)
// Tramo en edición (null = alta nueva).
const editingId = ref<string | null>(null)
const amount = ref('')
const chargeDay = ref('1')
const effectiveFrom = ref('')
const previewOpen = ref(false)
const toast = useToast()

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await $fetch<MortgageOverview>('/api/bank/mortgage')
  } catch {
    toast.add({ title: 'No se pudo cargar la hipoteca', color: 'error' })
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  resetForm()
  loadOverview()
})

function resetForm() {
  editingId.value = null
  amount.value = ''
  chargeDay.value = '1'
  effectiveFrom.value = ''
}

function startEdit(entry: ScheduleEntry) {
  editingId.value = entry.id
  amount.value = String(entry.amountCents / 100)
  chargeDay.value = String(entry.chargeDay)
  effectiveFrom.value = entry.effectiveFrom
}

async function saveEntry() {
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }
  if (!effectiveFrom.value) {
    toast.add({ title: 'Indica el mes desde el que aplica', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const body = { amountCents, chargeDay: Number(chargeDay.value), effectiveFrom: effectiveFrom.value }
    if (editingId.value) {
      await $fetch(`/api/bank/mortgage/${editingId.value}`, { method: 'PATCH', body })
    } else {
      await $fetch('/api/bank/mortgage', { method: 'POST', body })
    }
    resetForm()
    await loadOverview()
    emit('changed')
    toast.add({ title: 'Tramo guardado', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo guardar el tramo', color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function deleteEntry(entry: ScheduleEntry) {
  const confirmed = await useConfirmDialog()({
    title: 'Eliminar tramo',
    description: `Se eliminará el tramo de ${formatEuros(entry.amountCents)} desde ${entry.effectiveFrom}. Los cargos ya creados NO se tocan.`,
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return

  try {
    await $fetch(`/api/bank/mortgage/${entry.id}`, { method: 'DELETE' })
    await loadOverview()
    emit('changed')
    toast.add({ title: 'Tramo eliminado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo eliminar el tramo', color: 'error' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Hipoteca"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #content>
      <div class="flex flex-col gap-5 p-6">
        <p class="text-sm text-muted">
          Cada tramo indica el importe y el día de cargo a partir de un mes. El relleno crea los
          cargos que falten hasta hoy y nunca modifica los ya existentes.
        </p>

        <div class="flex flex-col divide-y divide-default">
          <div
            v-for="entry in overview?.schedule ?? []"
            :key="entry.id"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <div>
              <p class="font-medium">
                {{ formatEuros(entry.amountCents) }} · día {{ entry.chargeDay }}
              </p>
              <p class="text-muted">
                Desde {{ entry.effectiveFrom }}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="startEdit(entry)"
              >
                Editar
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="deleteEntry(entry)"
              >
                Eliminar
              </UButton>
            </div>
          </div>
          <p
            v-if="!loading && !(overview?.schedule ?? []).length"
            class="py-4 text-center text-sm text-muted"
          >
            Sin configurar
          </p>
        </div>

        <form
          class="grid grid-cols-1 gap-3 sm:grid-cols-3"
          @submit.prevent="saveEntry"
        >
          <UFormField label="Importe (€)">
            <UInput
              v-model="amount"
              type="number"
              step="0.01"
              min="0.01"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Día de cargo">
            <UInput
              v-model="chargeDay"
              type="number"
              min="1"
              max="31"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Desde el mes">
            <UInput
              v-model="effectiveFrom"
              type="month"
              class="w-full"
            />
          </UFormField>
          <div class="sm:col-span-3 flex justify-end gap-2">
            <UButton
              v-if="editingId"
              label="Cancelar edición"
              color="neutral"
              variant="outline"
              type="button"
              @click="resetForm"
            />
            <UButton
              type="submit"
              :loading="submitting"
            >
              {{ editingId ? 'Guardar cambios' : 'Añadir tramo' }}
            </UButton>
          </div>
        </form>

        <div class="flex items-center justify-between gap-2 border-t border-default pt-4">
          <p class="text-xs text-muted">
            Relleno generado hasta: {{ overview?.generatedThrough ?? '—' }}
          </p>
          <UButton
            icon="i-lucide-calendar-sync"
            color="primary"
            variant="soft"
            :disabled="!(overview?.schedule ?? []).length"
            @click="previewOpen = true"
          >
            Rellenar meses
          </UButton>
        </div>

        <div class="flex justify-end">
          <UButton
            label="Cerrar"
            color="neutral"
            variant="outline"
            @click="open = false"
          />
        </div>
      </div>
    </template>

    <BankMortgageBackfillDialog
      v-model:open="previewOpen"
      @confirmed="loadOverview(); emit('changed')"
    />
  </UModal>
</template>
