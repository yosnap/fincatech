<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Member {
  id: string
  name: string
  role: string
}

interface Extraction {
  date: string | null
  vendor: string | null
  amountCents: number | null
  taxCents: number | null
  concept: string | null
  confidence: number
}

const session = authClient.useSession()
const { data: membersData } = await useFetch<{ members: Member[] }>('/api/expenses/participants')

const step = ref<'upload' | 'review'>('upload')
const file = ref<File | null>(null)
const extracting = ref(false)
const confirming = ref(false)
const errorMessage = ref('')
const costUsd = ref(0)

const description = ref('')
const amount = ref('')
const tax = ref('')
const confidence = ref(0)
const selectedIds = ref<string[]>([])

watchEffect(() => {
  const currentId = session.value.data?.user.id
  const isMember = (membersData.value?.members ?? []).some(m => m.id === currentId)
  if (currentId && isMember && !selectedIds.value.includes(currentId)) {
    selectedIds.value = [...selectedIds.value, currentId]
  }
})

function buildDescription(extraction: Extraction): string {
  const parts = [extraction.vendor, extraction.concept].filter(Boolean)
  return parts.length > 0 ? parts.join(' — ') : 'Ticket sin datos legibles'
}

async function onExtract() {
  if (!file.value) {
    errorMessage.value = 'Selecciona una imagen del ticket'
    return
  }
  errorMessage.value = ''
  extracting.value = true
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    const result = await $fetch<{ extraction: Extraction, costUsd: number }>('/api/ocr/extract', {
      method: 'POST',
      body: formData
    })
    description.value = buildDescription(result.extraction)
    amount.value = result.extraction.amountCents != null ? (result.extraction.amountCents / 100).toFixed(2) : ''
    tax.value = result.extraction.taxCents != null ? (result.extraction.taxCents / 100).toFixed(2) : ''
    confidence.value = result.extraction.confidence
    costUsd.value = result.costUsd
    step.value = 'review'
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode
    errorMessage.value = statusCode === 503
      ? 'El OCR no está disponible ahora mismo. Registra el gasto manualmente desde el libro contable.'
      : 'No se pudo extraer el ticket. Puedes registrar el gasto manualmente.'
  } finally {
    extracting.value = false
  }
}

function toggleParticipant(memberId: string, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, memberId]
    : selectedIds.value.filter(id => id !== memberId)
}

async function onConfirm() {
  if (!file.value) return
  errorMessage.value = ''
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    errorMessage.value = 'Importe inválido'
    return
  }
  if (selectedIds.value.length === 0) {
    errorMessage.value = 'Selecciona al menos un participante'
    return
  }

  confirming.value = true
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    formData.append('description', description.value)
    formData.append('amountCents', String(amountCents))
    if (tax.value) {
      const taxCents = Math.round(Number(tax.value) * 100)
      if (Number.isFinite(taxCents) && taxCents >= 0) formData.append('taxCents', String(taxCents))
    }
    formData.append('participantIds', JSON.stringify(selectedIds.value))
    formData.append('confidence', String(confidence.value))
    formData.append('costUsd', String(costUsd.value))
    const result = await $fetch<{ expense: { id: string } }>('/api/ocr/confirm', {
      method: 'POST',
      body: formData
    })
    await navigateTo(`/ledger/${result.expense.id}`)
  } catch {
    errorMessage.value = 'No se pudo crear el gasto'
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Nuevo gasto desde ticket (OCR)
    </h1>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

    <UCard v-if="step === 'upload'">
      <template #header>
        <h2 class="text-lg font-semibold">
          1. Sube la foto del ticket
        </h2>
      </template>

      <div class="flex flex-col gap-4">
        <FilePicker
          v-model="file"
          label="Sube la foto del ticket"
        />
        <UButton
          :loading="extracting"
          :disabled="!file"
          @click="onExtract"
        >
          Extraer datos
        </UButton>
        <UButton
          to="/ledger"
          variant="link"
          color="neutral"
        >
          O registra el gasto manualmente
        </UButton>
      </div>
    </UCard>

    <UCard v-else>
      <template #header>
        <h2 class="text-lg font-semibold">
          2. Revisa y confirma
        </h2>
      </template>

      <form
        class="flex flex-col gap-4"
        @submit.prevent="onConfirm"
      >
        <UAlert
          color="warning"
          variant="soft"
          :title="`Confianza de la extracción: ${Math.round(confidence * 100)}%`"
          description="Revisa los datos antes de confirmar — el OCR puede equivocarse."
        />

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

        <UFormField label="IVA / impuestos (opcional, ya incluido en el importe)">
          <UInput
            v-model="tax"
            type="number"
            step="0.01"
            min="0"
            class="w-full"
          />
        </UFormField>

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

        <div class="flex gap-2">
          <UButton
            type="submit"
            :loading="confirming"
          >
            Confirmar y crear gasto
          </UButton>
          <UButton
            variant="soft"
            color="neutral"
            @click="step = 'upload'"
          >
            Volver
          </UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>
