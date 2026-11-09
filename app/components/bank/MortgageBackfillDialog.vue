<script setup lang="ts">
// Vista previa → confirmación del relleno de la hipoteca (RT-9). Muestra los meses que se van a
// crear, los meses cuyo cargo está en la papelera (se restauran desde /admin/trash, no se
// recrean) y los pagos manuales que se pueden ADOPTAR como cargo automático de su mes.

interface PlannedCharge {
  month: string
  date: string
  amountCents: number
  scheduleId: string
}

interface ManualCandidate {
  id: string
  month: string
  date: string
  amountCents: number
  description: string
  amountMatches: boolean
}

interface Preview {
  toCreate: PlannedCharge[]
  toRestore: string[]
  candidates: ManualCandidate[]
}

const emit = defineEmits<{ confirmed: [] }>()

const open = defineModel<boolean>('open', { default: false })

const preview = ref<Preview | null>(null)
const loading = ref(false)
const submitting = ref(false)
// Ids de los pagos manuales que el admin adopta (por defecto, todos los que coinciden en importe).
const adopted = ref<string[]>([])
const toast = useToast()

// Mes en curso en Madrid ('AAAA-MM'): tope y valor por defecto de «Hasta».
const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date())
const until = ref(currentMonth)

async function loadPreview() {
  loading.value = true
  try {
    preview.value = await $fetch<Preview>('/api/bank/mortgage/backfill/preview', { query: { until: until.value } })
    adopted.value = (preview.value?.candidates ?? [])
      .filter(candidate => candidate.amountMatches)
      .map(candidate => candidate.id)
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo previsualizar el relleno', color: 'error' })
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  until.value = currentMonth
  void loadPreview()
})

watch(until, (value, previous) => {
  if (!open.value || value === previous) return
  // Un valor vacío o futuro no es válido: se vuelve al mes en curso.
  if (!/^\d{4}-\d{2}$/.test(value) || value > currentMonth) {
    until.value = currentMonth
    return
  }
  void loadPreview()
})

const monthsToCreateAfterAdoption = computed(() => {
  const adoptedMonths = new Set(
    (preview.value?.candidates ?? [])
      .filter(candidate => adopted.value.includes(candidate.id))
      .map(candidate => candidate.month)
  )
  return (preview.value?.toCreate ?? []).filter(charge => !adoptedMonths.has(charge.month))
})

const summary = computed(() => {
  const createCount = monthsToCreateAfterAdoption.value.length
  const adoptCount = adopted.value.length
  return `Se crearán ${createCount} ${createCount === 1 ? 'cargo' : 'cargos'} y se adoptarán ${adoptCount} ${adoptCount === 1 ? 'pago' : 'pagos'}`
})

async function confirm() {
  submitting.value = true
  try {
    const result = await $fetch<{ created: PlannedCharge[], adopted: unknown[], toRestore: string[] }>(
      '/api/bank/mortgage/backfill/confirm',
      { method: 'POST', body: { adoptTransactionIds: adopted.value, until: until.value } }
    )
    const restoreNote = result.toRestore.length > 0
      ? ` · ${result.toRestore.length} mes(es) con cargo en la papelera: restáuralo desde /admin/trash`
      : ''
    toast.add({ title: `Hipoteca rellenada: ${result.created.length} cargo(s) creado(s)${restoreNote}`, color: 'success' })
    open.value = false
    emit('confirmed')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo rellenar la hipoteca', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Rellenar cargos de la hipoteca"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #content>
      <div class="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6">
        <UFormField
          label="Rellenar hasta"
          description="Se crean los meses que falten desde el inicio del primer tramo hasta este mes, incluido."
        >
          <UInput
            v-model="until"
            type="month"
            :max="currentMonth"
          />
        </UFormField>

        <p
          v-if="loading"
          class="text-sm text-muted"
        >
          Calculando…
        </p>

        <template v-else-if="preview">
          <section v-if="preview.candidates.length">
            <h3 class="mb-2 text-sm font-semibold">
              Pagos manuales que pueden ser el cargo del mes
            </h3>
            <p class="mb-2 text-xs text-muted">
              Adoptarlos los marca como cargo automático de su mes y conservan su justificante.
              Nada se borra.
            </p>
            <div class="flex flex-col divide-y divide-default">
              <label
                v-for="candidate in preview.candidates"
                :key="candidate.id"
                class="flex items-center gap-3 py-2 text-sm"
              >
                <UCheckbox
                  v-model="adopted"
                  :value="candidate.id"
                />
                <span class="flex-1">
                  <span class="font-medium">{{ candidate.month }}</span>
                  · {{ candidate.description }}
                  <span class="text-muted">· {{ formatEuros(candidate.amountCents) }}</span>
                  <UBadge
                    v-if="!candidate.amountMatches"
                    color="warning"
                    variant="subtle"
                    size="sm"
                    class="ml-1"
                  >
                    Solo coincide la descripción
                  </UBadge>
                </span>
              </label>
            </div>
          </section>

          <section>
            <h3 class="mb-2 text-sm font-semibold">
              Meses que se crearán
            </h3>
            <div class="flex flex-col divide-y divide-default">
              <div
                v-for="charge in monthsToCreateAfterAdoption"
                :key="charge.month"
                class="flex items-center justify-between py-1.5 text-sm"
              >
                <span>{{ charge.month }}</span>
                <span class="text-muted">{{ formatEuros(charge.amountCents) }} · {{ new Date(`${charge.date}T00:00:00`).toLocaleDateString('es-ES') }}</span>
              </div>
              <p
                v-if="!monthsToCreateAfterAdoption.length"
                class="py-2 text-sm text-muted"
              >
                Ningún mes pendiente.
              </p>
            </div>
          </section>

          <section v-if="preview.toRestore.length">
            <h3 class="mb-2 text-sm font-semibold">
              Meses con el cargo en la papelera
            </h3>
            <p class="text-sm text-muted">
              {{ preview.toRestore.join(', ') }} — no se recrean: restáuralos desde la papelera
              de Admin.
            </p>
          </section>

          <p class="text-sm font-medium">
            {{ summary }}
          </p>
        </template>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="outline"
            @click="open = false"
          />
          <UButton
            :loading="submitting"
            :disabled="loading || !preview"
            @click="confirm"
          >
            Confirmar relleno
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
