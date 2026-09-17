<script setup lang="ts">
// Registro de aporte (modal). Opción A: cada miembro registra la suya; opción B: el Admin
// registra por otra persona (registeredBy queda marcado). Cuotas: importe de UNA cuota y
// selector de meses para el adelanto multi-mes. El justificante SOLO se acepta con
// method='transfer' (es el ticket bancario y va al movimiento auto-creado).

interface Member {
  id: string
  name: string
}

interface Props {
  members: Member[]
  isAdmin: boolean
  currentUserId: string
  quotaAmountCents: number | null
  // Preselección al abrir desde una celda del grid de cuotas.
  initialMemberId?: string
  initialPeriod?: string
  initialType?: 'quota' | 'pre_purchase' | 'extraordinary'
}

const props = defineProps<Props>()

const emit = defineEmits<{ created: [] }>()

const open = defineModel<boolean>('open', { default: false })

const TYPE_OPTIONS = [
  { label: 'Cuota mensual', value: 'quota' },
  { label: 'Aporte pre-compra (histórico)', value: 'pre_purchase' },
  { label: 'Aporte extraordinario', value: 'extraordinary' }
]

const METHOD_OPTIONS = [
  { label: 'Efectivo (queda pendiente de depósito)', value: 'cash' },
  { label: 'Transferencia (crea el ingreso bancario)', value: 'transfer' }
]

const MONTH_COUNT_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  label: i === 0 ? '1 mes' : `${i + 1} meses`,
  value: i + 1
}))

const memberId = ref(props.currentUserId)
const type = ref<'quota' | 'pre_purchase' | 'extraordinary'>('quota')
const amount = ref('')
const period = ref('')
const months = ref(1)
const method = ref<'cash' | 'transfer'>('transfer')
const date = ref(new Date().toISOString().slice(0, 10))
const notes = ref('')
const proofFile = ref<File | null>(null)
const submitting = ref(false)
const toast = useToast()

watch(open, (isOpen) => {
  if (!isOpen) return
  memberId.value = props.initialMemberId ?? props.currentUserId
  type.value = props.initialType ?? 'quota'
  period.value = props.initialPeriod ?? new Date().toISOString().slice(0, 7)
  months.value = 1
  method.value = 'transfer'
  date.value = new Date().toISOString().slice(0, 10)
  notes.value = ''
  proofFile.value = null
  amount.value = props.quotaAmountCents != null && type.value === 'quota'
    ? String(props.quotaAmountCents / 100)
    : ''
})

// Al cambiar de tipo, re-precargar el importe de la cuota si vuelve a cuota.
watch(type, (newType) => {
  if (newType === 'quota' && props.quotaAmountCents != null && !amount.value) {
    amount.value = String(props.quotaAmountCents / 100)
  }
})

async function onSubmit() {
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }
  if (type.value === 'quota' && !period.value) {
    toast.add({ title: 'Selecciona el mes de la cuota', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('memberId', memberId.value)
    formData.append('amountCents', String(amountCents))
    formData.append('type', type.value)
    if (type.value === 'quota') {
      formData.append('period', period.value)
      formData.append('months', String(months.value))
    }
    formData.append('method', method.value)
    formData.append('date', date.value)
    if (notes.value.trim()) formData.append('notes', notes.value)
    if (proofFile.value) formData.append('proof', proofFile.value)

    await $fetch('/api/bank/contributions', { method: 'POST', body: formData })
    open.value = false
    emit('created')
    toast.add({
      title: type.value === 'quota' && months.value > 1
        ? `Cuotas registradas (${months.value} meses)`
        : 'Aporte registrado',
      color: 'success'
    })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo registrar el aporte', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Registrar aporte"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onSubmit"
      >
        <UFormField
          v-if="isAdmin"
          label="Miembro"
          help="Como Admin puedes registrar el aporte de otra persona; quedará marcado quién lo registró."
        >
          <USelect
            v-model="memberId"
            :items="members.map(m => ({ label: m.name, value: m.id }))"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Tipo de aporte">
          <USelect
            v-model="type"
            :items="TYPE_OPTIONS"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="type === 'quota'"
          label="Mes de la cuota"
        >
          <UInput
            v-model="period"
            type="month"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="type === 'quota'"
          label="Pagar por adelantado"
          help="Crea una fila por mes (mismo importe, fecha y método) en una sola operación."
        >
          <USelect
            v-model="months"
            :items="MONTH_COUNT_OPTIONS"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Importe (€)">
          <UInput
            v-model="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Método">
          <USelect
            v-model="method"
            :items="METHOD_OPTIONS"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Fecha del aporte">
          <UInput
            v-model="date"
            type="date"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Notas (opcional)"
        >
          <UInput
            v-model="notes"
            class="w-full"
          />
        </UFormField>

        <FilePicker
          v-if="method === 'transfer'"
          v-model="proofFile"
          accept="image/jpeg,image/png,application/pdf"
          label="Justificante de la transferencia (opcional)"
          description="JPEG, PNG o PDF, máx. 10MB — se adjunta al ingreso bancario"
        />
        <p
          v-else
          class="text-xs text-muted"
        >
          El aporte en efectivo no lleva justificante: lo trae su depósito al vincularlo al
          ingreso bancario.
        </p>

        <div class="mt-2 flex justify-end gap-2">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="outline"
            type="button"
            @click="open = false"
          />
          <UButton
            type="submit"
            :loading="submitting"
          >
            Registrar aporte
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
