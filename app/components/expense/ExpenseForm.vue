<script setup lang="ts">
interface Member {
  id: string
  name: string
  role: string
}

const emit = defineEmits<{ created: [] }>()

const { data: membersData } = await useFetch<{ members: Member[] }>('/api/expenses/participants')

const TYPE_OPTIONS = [
  { label: 'Gasto manual', value: 'manual' },
  { label: 'Recibo bancario (liquidado en origen)', value: 'bank_receipt' }
]

const amount = ref('')
const description = ref('')
const type = ref<'manual' | 'bank_receipt'>('manual')
const hasProof = ref(true)
const proofFile = ref<File | null>(null)
// Todos los miembros activos preseleccionados por defecto (un gasto normalmente se reparte
// entre todos) — el admin desmarca a quien no corresponda en vez de marcar uno a uno.
const selectedIds = ref<string[]>((membersData.value?.members ?? []).map(m => m.id))
const submitting = ref(false)
const toast = useToast()

function toggleParticipant(memberId: string, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, memberId]
    : selectedIds.value.filter(id => id !== memberId)
}

async function onSubmit() {
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }
  if (selectedIds.value.length === 0) {
    toast.add({ title: 'Selecciona al menos un participante', color: 'warning' })
    return
  }
  if (hasProof.value && !proofFile.value) {
    toast.add({ title: 'Sube el justificante o desmarca "Tengo comprobante"', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('amountCents', String(amountCents))
    formData.append('description', description.value)
    formData.append('type', type.value)
    formData.append('participantIds', JSON.stringify(selectedIds.value))
    formData.append('hasProof', String(hasProof.value))
    if (proofFile.value) formData.append('proof', proofFile.value)

    await $fetch('/api/expenses', { method: 'POST', body: formData })
    amount.value = ''
    description.value = ''
    proofFile.value = null
    emit('created')
    toast.add({ title: 'Gasto creado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo crear el gasto', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">
        Registrar gasto
      </h2>
    </template>

    <form
      class="flex flex-col gap-4"
      @submit.prevent="onSubmit"
    >
      <UFormField label="Descripción">
        <UInput
          v-model="description"
          required
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

      <UFormField label="Tipo">
        <USelect
          v-model="type"
          :items="TYPE_OPTIONS"
          class="w-full"
        />
      </UFormField>

      <UCheckbox
        v-model="hasProof"
        label="Tengo comprobante del ticket"
      />

      <FilePicker
        v-if="hasProof"
        v-model="proofFile"
        accept="image/jpeg,image/png,application/pdf"
        label="Sube la foto o PDF del ticket"
        description="JPEG, PNG o PDF, máx. 10MB"
      />

      <UFormField label="Participantes (se reparte el gasto entre ellos)">
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-for="member in membersData?.members ?? []"
            :key="member.id"
            :model-value="selectedIds.includes(member.id)"
            :label="member.name"
            @update:model-value="(checked) => toggleParticipant(member.id, checked === true)"
          />
        </div>
      </UFormField>

      <UButton
        type="submit"
        :loading="submitting"
      >
        Crear gasto
      </UButton>
    </form>
  </UCard>
</template>
