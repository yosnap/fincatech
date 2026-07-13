<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Quote {
  id: string
  label: string
  priceCents: number
  conditions: string | null
  attachmentObjectName: string | null
  voteCount: number
}

interface Proposal {
  id: string
  title: string
  description: string
  status: string
  winningQuoteId: string | null
  authorId: string
}

interface MediaItem {
  id: string
  createdAt: string
  uploadedBy: string
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ proposal: Proposal, quotes: Quote[], myVoteQuoteId: string | null, media: MediaItem[] }>(
  `/api/proposals/${route.params.id}`
)

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canManage = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')
const canCancel = computed(() => currentUserRole.value === 'admin' || data.value?.proposal.authorId === currentUserId.value)
const isVoting = computed(() => data.value?.proposal.status === 'voting')

const errorMessage = ref('')
const busy = ref(false)

const quoteLabel = ref('')
const quotePrice = ref('')
const quoteConditions = ref('')
const quoteFile = ref<File | null>(null)

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function onQuoteFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  quoteFile.value = input.files?.[0] ?? null
}

async function onAddQuote() {
  errorMessage.value = ''
  const priceCents = Math.round(Number(quotePrice.value) * 100)
  if (!quoteLabel.value.trim() || !Number.isFinite(priceCents) || priceCents <= 0) {
    errorMessage.value = 'Completa la etiqueta y un importe válido'
    return
  }
  busy.value = true
  try {
    const formData = new FormData()
    formData.append('label', quoteLabel.value)
    formData.append('priceCents', String(priceCents))
    if (quoteConditions.value) formData.append('conditions', quoteConditions.value)
    if (quoteFile.value) formData.append('attachment', quoteFile.value)
    await $fetch(`/api/proposals/${route.params.id}/quotes`, { method: 'POST', body: formData })
    quoteLabel.value = ''
    quotePrice.value = ''
    quoteConditions.value = ''
    quoteFile.value = null
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo añadir la cotización'
  } finally {
    busy.value = false
  }
}

async function viewAttachment(quoteId: string) {
  const result = await $fetch<{ url: string }>(`/api/proposals/${route.params.id}/quotes/${quoteId}/attachment`)
  window.open(result.url, '_blank')
}

function canDeletePhoto(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

async function viewPhoto(mediaId: string) {
  const result = await $fetch<{ url: string }>(`/api/proposals/${route.params.id}/media/${mediaId}`)
  window.open(result.url, '_blank')
}

async function deletePhoto(mediaId: string) {
  if (!confirm('¿Borrar esta foto? No se puede deshacer.')) return
  await $fetch(`/api/media/${mediaId}`, { method: 'DELETE' })
  await refresh()
}

async function onVote(quoteId: string) {
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/proposals/${route.params.id}/vote`, { method: 'POST', body: { quoteId } })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo registrar tu voto (¿ya habías votado?)'
  } finally {
    busy.value = false
  }
}

async function onClose(overrideQuoteId?: string) {
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/proposals/${route.params.id}/close`, { method: 'POST', body: { overrideQuoteId } })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo cerrar la votación (puede haber empate: el Admin debe elegir la opción ganadora)'
  } finally {
    busy.value = false
  }
}

async function onCancel() {
  if (!confirm('¿Seguro que quieres cancelar esta propuesta? No se podrá revertir.')) return
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/proposals/${route.params.id}/cancel`, { method: 'POST' })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo cancelar la propuesta'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold">
            {{ data.proposal.title }}
          </h1>
          <UBadge
            :color="data.proposal.status === 'approved' ? 'success' : data.proposal.status === 'cancelled' ? 'error' : 'neutral'"
            variant="soft"
          >
            {{ data.proposal.status === 'approved' ? 'Aprobada' : data.proposal.status === 'cancelled' ? 'Cancelada' : 'En votación' }}
          </UBadge>
        </div>
      </template>
      <p class="whitespace-pre-wrap text-sm">
        {{ data.proposal.description }}
      </p>

      <template
        v-if="isVoting && canCancel"
        #footer
      >
        <UButton
          size="xs"
          color="error"
          variant="soft"
          :loading="busy"
          @click="onCancel"
        >
          Cancelar propuesta
        </UButton>
      </template>
    </UCard>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Cotizaciones
        </h2>
      </template>

      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="quote in data.quotes"
          :key="quote.id"
          class="flex flex-col gap-2 py-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium">
                {{ quote.label }}
              </p>
              <p class="text-sm text-muted">
                {{ formatEuros(quote.priceCents) }}
                <span v-if="quote.conditions"> · {{ quote.conditions }}</span>
              </p>
              <UButton
                v-if="quote.attachmentObjectName"
                size="xs"
                variant="link"
                class="px-0"
                @click="viewAttachment(quote.id)"
              >
                Ver PDF adjunto
              </UButton>
            </div>
            <div class="flex items-center gap-2">
              <UBadge
                v-if="data.proposal.winningQuoteId === quote.id"
                color="success"
                variant="soft"
              >
                Ganadora
              </UBadge>
              <UBadge variant="soft">
                {{ quote.voteCount }} {{ quote.voteCount === 1 ? 'voto' : 'votos' }}
              </UBadge>
            </div>
          </div>

          <div
            v-if="isVoting && canManage"
            class="flex justify-end"
          >
            <UButton
              size="xs"
              :variant="data.myVoteQuoteId === quote.id ? 'solid' : 'soft'"
              :disabled="!!data.myVoteQuoteId"
              :loading="busy"
              @click="onVote(quote.id)"
            >
              {{ data.myVoteQuoteId === quote.id ? 'Tu voto' : 'Votar esta opción' }}
            </UButton>
          </div>

          <div
            v-if="isVoting && currentUserRole === 'admin'"
            class="flex justify-end"
          >
            <UButton
              size="xs"
              variant="link"
              color="neutral"
              :loading="busy"
              @click="onClose(quote.id)"
            >
              Forzar esta opción como ganadora y cerrar
            </UButton>
          </div>
        </div>

        <p
          v-if="!data.quotes.length"
          class="py-4 text-center text-muted"
        >
          Sin cotizaciones todavía
        </p>
      </div>

      <template
        v-if="isVoting && canManage"
        #footer
      >
        <form
          class="flex flex-col gap-3"
          @submit.prevent="onAddQuote"
        >
          <p class="text-sm font-medium">
            Añadir cotización
          </p>
          <UFormField label="Etiqueta (p.ej. 'Opción A')">
            <UInput
              v-model="quoteLabel"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField label="Importe (€)">
            <UInput
              v-model="quotePrice"
              type="number"
              step="0.01"
              min="0.01"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField label="Condiciones (opcional)">
            <UInput
              v-model="quoteConditions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="PDF adjunto (opcional)">
            <input
              type="file"
              accept="application/pdf"
              class="text-sm"
              @change="onQuoteFileChange"
            >
          </UFormField>
          <UButton
            type="submit"
            size="sm"
            :loading="busy"
          >
            Añadir cotización
          </UButton>
        </form>
      </template>
    </UCard>

    <UButton
      v-if="isVoting && canManage && data.quotes.length"
      color="success"
      :loading="busy"
      @click="onClose()"
    >
      Cerrar votación (gana la opción con más votos)
    </UButton>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Galería
        </h2>
      </template>

      <div class="grid grid-cols-3 gap-2">
        <div
          v-for="photo in data.media"
          :key="photo.id"
          class="flex items-center gap-1"
        >
          <UButton
            size="xs"
            variant="soft"
            class="flex-1"
            @click="viewPhoto(photo.id)"
          >
            {{ new Date(photo.createdAt).toLocaleDateString('es-ES') }}
          </UButton>
          <UButton
            v-if="canDeletePhoto(photo)"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="deletePhoto(photo.id)"
          />
        </div>
      </div>
      <p
        v-if="!data.media.length"
        class="py-2 text-center text-sm text-muted"
      >
        Sin fotos todavía
      </p>

      <MediaPhotoUpload
        v-if="canManage"
        :upload-url="`/api/proposals/${route.params.id}/media`"
        class="mt-4"
        @uploaded="refresh"
      />
    </UCard>
  </div>
</template>
