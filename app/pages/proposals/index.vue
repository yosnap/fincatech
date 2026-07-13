<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Proposal {
  id: string
  title: string
  description: string
  status: string
  createdAt: string
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ proposals: Proposal[] }>('/api/proposals')

const STATUS_LABELS: Record<string, string> = {
  voting: 'En votación',
  approved: 'Aprobada',
  cancelled: 'Cancelada'
}

const canCreate = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

const title = ref('')
const description = ref('')
const submitting = ref(false)
const errorMessage = ref('')

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch('/api/proposals', { method: 'POST', body: { title: title.value, description: description.value } })
    title.value = ''
    description.value = ''
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo crear la propuesta'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Propuestas
    </h1>

    <UCard v-if="canCreate">
      <template #header>
        <h2 class="text-lg font-semibold">
          Nueva propuesta
        </h2>
      </template>
      <form
        class="flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Título">
          <UInput
            v-model="title"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Descripción">
          <UTextarea
            v-model="description"
            required
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :title="errorMessage"
        />
        <UButton
          type="submit"
          :loading="submitting"
        >
          Crear propuesta
        </UButton>
      </form>
    </UCard>

    <UCard>
      <div class="flex flex-col divide-y divide-default">
        <NuxtLink
          v-for="proposal in data?.proposals ?? []"
          :key="proposal.id"
          :to="`/proposals/${proposal.id}`"
          class="flex items-center justify-between py-3"
        >
          <p class="font-medium">
            {{ proposal.title }}
          </p>
          <UBadge variant="soft">
            {{ STATUS_LABELS[proposal.status] ?? proposal.status }}
          </UBadge>
        </NuxtLink>
        <p
          v-if="!data?.proposals?.length"
          class="py-6 text-center text-muted"
        >
          Sin propuestas todavía
        </p>
      </div>
    </UCard>
  </div>
</template>
