<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Comment {
  id: string
  authorId: string
  body: string
  createdAt: string
}

interface Idea {
  id: string
  title: string
  description: string
  status: string
  authorId: string
  createdAt: string
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ idea: Idea, comments: Comment[] }>(`/api/ideas/${route.params.id}`)

const STATUS_LABELS: Record<string, string> = {
  new: 'Nueva',
  discussion: 'En discusión',
  promoted: 'Promovida a propuesta',
  discarded: 'Descartada'
}

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canManage = computed(() => currentUserRole.value === 'admin' || data.value?.idea.authorId === currentUserId.value)
const canComment = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')
const isOpen = computed(() => data.value?.idea.status === 'new' || data.value?.idea.status === 'discussion')

const commentBody = ref('')
const errorMessage = ref('')
const busy = ref(false)

async function onComment() {
  if (!commentBody.value.trim()) return
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/ideas/${route.params.id}/comments`, { method: 'POST', body: { body: commentBody.value } })
    commentBody.value = ''
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo publicar el comentario'
  } finally {
    busy.value = false
  }
}

async function setStatus(status: 'discussion' | 'discarded') {
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/ideas/${route.params.id}/status`, { method: 'PATCH', body: { status } })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo cambiar el estado'
  } finally {
    busy.value = false
  }
}

async function onPromote() {
  errorMessage.value = ''
  busy.value = true
  try {
    const result = await $fetch<{ proposal: { id: string } }>(`/api/ideas/${route.params.id}/promote`, { method: 'POST' })
    await navigateTo(`/proposals/${result.proposal.id}`)
  } catch {
    errorMessage.value = 'No se pudo promover la idea'
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
            {{ data.idea.title }}
          </h1>
          <UBadge variant="soft">
            {{ STATUS_LABELS[data.idea.status] ?? data.idea.status }}
          </UBadge>
        </div>
      </template>
      <p class="whitespace-pre-wrap text-sm">
        {{ data.idea.description }}
      </p>

      <template
        v-if="canManage && isOpen"
        #footer
      >
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="data.idea.status === 'new'"
            size="sm"
            variant="soft"
            :loading="busy"
            @click="setStatus('discussion')"
          >
            Pasar a discusión
          </UButton>
          <UButton
            size="sm"
            color="success"
            :loading="busy"
            @click="onPromote"
          >
            Promover a propuesta
          </UButton>
          <UButton
            size="sm"
            color="error"
            variant="soft"
            :loading="busy"
            @click="setStatus('discarded')"
          >
            Descartar
          </UButton>
        </div>
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
          Comentarios
        </h2>
      </template>

      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="comment in data.comments"
          :key="comment.id"
          class="py-3 text-sm"
        >
          {{ comment.body }}
        </div>
        <p
          v-if="!data.comments.length"
          class="py-4 text-center text-muted"
        >
          Sin comentarios todavía
        </p>
      </div>

      <form
        v-if="canComment"
        class="mt-4 flex flex-col gap-2"
        @submit.prevent="onComment"
      >
        <UTextarea
          v-model="commentBody"
          placeholder="Escribe un comentario..."
          class="w-full"
        />
        <UButton
          type="submit"
          size="sm"
          :loading="busy"
        >
          Comentar
        </UButton>
      </form>
    </UCard>
  </div>
</template>
