<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Member {
  id: string
  name: string
  role: string
}

interface Draft {
  objectName: string
  contentType: 'image/jpeg' | 'image/png'
  extraction: {
    date: string | null
    vendor: string | null
    amountCents: number | null
    taxCents: number | null
    concept: string | null
    confidence: number
  }
  costUsd: number
}

const route = useRoute()
const session = authClient.useSession()
const { data: membersData } = await useFetch<{ members: Member[] }>('/api/expenses/participants')

const toast = useToast()
const confirming = ref(false)

// atob/TextDecoder (no Buffer): esto corre tanto en SSR como, tras hidratar, en el navegador.
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const draft = computed<Draft | null>(() => {
  const raw = route.query.data
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(decodeBase64Url(raw)) as Draft
  } catch {
    return null
  }
})

const description = ref('')
const amount = ref('')
const tax = ref('')
const selectedIds = ref<string[]>([])

watchEffect(() => {
  const d = draft.value
  if (!d) return
  const parts = [d.extraction.vendor, d.extraction.concept].filter(Boolean)
  description.value = parts.length > 0 ? parts.join(' — ') : 'Ticket sin datos legibles'
  amount.value = d.extraction.amountCents != null ? (d.extraction.amountCents / 100).toFixed(2) : ''
  tax.value = d.extraction.taxCents != null ? (d.extraction.taxCents / 100).toFixed(2) : ''
})

watchEffect(() => {
  const currentId = session.value.data?.user.id
  const isMember = (membersData.value?.members ?? []).some(m => m.id === currentId)
  if (currentId && isMember && !selectedIds.value.includes(currentId)) {
    selectedIds.value = [...selectedIds.value, currentId]
  }
})

function toggleParticipant(memberId: string, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, memberId]
    : selectedIds.value.filter(id => id !== memberId)
}

async function onConfirm() {
  if (!draft.value) return
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }
  if (selectedIds.value.length === 0) {
    toast.add({ title: 'Selecciona al menos un participante', color: 'warning' })
    return
  }

  confirming.value = true
  try {
    const taxCents = tax.value ? Math.round(Number(tax.value) * 100) : undefined
    const result = await $fetch<{ expense: { id: string } }>('/api/ocr/confirm-from-link', {
      method: 'POST',
      body: {
        objectName: draft.value.objectName,
        contentType: draft.value.contentType,
        description: description.value,
        amountCents,
        taxCents: taxCents != null && Number.isFinite(taxCents) && taxCents >= 0 ? taxCents : undefined,
        participantIds: selectedIds.value,
        confidence: draft.value.extraction.confidence,
        costUsd: draft.value.costUsd
      }
    })
    await navigateTo(`/ledger/${result.expense.id}`)
  } catch {
    toast.add({ title: 'No se pudo crear el gasto', color: 'error' })
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Confirmar ticket recibido por Telegram
    </h1>

    <UAlert
      v-if="!draft"
      color="error"
      variant="soft"
      title="Enlace inválido o caducado"
      description="Envía la foto de nuevo al bot de Telegram."
    />

    <template v-else>
      <UCard>
        <UAlert
          color="warning"
          variant="soft"
          :title="`Confianza de la extracción: ${Math.round(draft.extraction.confidence * 100)}%`"
          description="Revisa los datos antes de confirmar — el OCR puede equivocarse."
        />

        <form
          class="mt-4 flex flex-col gap-4"
          @submit.prevent="onConfirm"
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

          <UButton
            type="submit"
            :loading="confirming"
          >
            Confirmar y crear gasto
          </UButton>
        </form>
      </UCard>
    </template>
  </div>
</template>
