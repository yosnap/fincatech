<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Comment {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

interface Idea {
  id: string
  title: string
  description: string
  status: string
  authorId: string
  authorName: string
  createdAt: string
}

interface MediaItem {
  id: string
  createdAt: string
  uploadedBy: string
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ idea: Idea, comments: Comment[], media: MediaItem[] }>(`/api/ideas/${route.params.id}`)

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
const canUploadPhoto = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')
const isOpen = computed(() => data.value?.idea.status === 'new' || data.value?.idea.status === 'discussion')

const commentBody = ref('')
const busy = ref(false)
const toast = useToast()

function canDeletePhoto(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

async function viewPhoto(mediaId: string) {
  const result = await $fetch<{ url: string }>(`/api/ideas/${route.params.id}/media/${mediaId}`)
  window.open(result.url, '_blank')
}

async function deletePhoto(mediaId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Borrar foto',
    description: 'No se puede deshacer.',
    confirmLabel: 'Borrar',
    color: 'error'
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/media/${mediaId}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Foto borrada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo borrar la foto', color: 'error' })
  }
}

async function deleteComment(commentId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Eliminar comentario',
    description: 'No se puede deshacer.',
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/ideas/${route.params.id}/comments/${commentId}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Comentario eliminado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo eliminar el comentario', color: 'error' })
  }
}

async function onComment() {
  if (!commentBody.value.trim()) return
  busy.value = true
  try {
    await $fetch(`/api/ideas/${route.params.id}/comments`, { method: 'POST', body: { body: commentBody.value } })
    commentBody.value = ''
    await refresh()
    toast.add({ title: 'Comentario publicado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo publicar el comentario', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function setStatus(status: 'discussion' | 'discarded') {
  busy.value = true
  try {
    await $fetch(`/api/ideas/${route.params.id}/status`, { method: 'PATCH', body: { status } })
    await refresh()
    toast.add({ title: 'Estado actualizado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo cambiar el estado', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function onPromote() {
  busy.value = true
  try {
    const result = await $fetch<{ proposal: { id: string } }>(`/api/ideas/${route.params.id}/promote`, { method: 'POST' })
    toast.add({ title: 'Idea promovida a propuesta', color: 'success' })
    await navigateTo(`/proposals/${result.proposal.id}`)
  } catch {
    toast.add({ title: 'No se pudo promover la idea', color: 'error' })
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <UButton
      icon="i-lucide-arrow-left"
      variant="ghost"
      color="neutral"
      size="sm"
      class="self-start"
      to="/ideas"
    >
      Volver
    </UButton>
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-lg font-semibold">
              {{ data.idea.title }}
            </h1>
            <p class="text-xs text-muted">
              Por {{ data.idea.authorName }}
            </p>
          </div>
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
        <div class="flex flex-col gap-2">
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
          <p class="text-xs text-muted">
            Descartar oculta la idea para todos. Solo un administrador puede borrarla definitivamente, desde la Papelera.
          </p>
        </div>
      </template>
    </UCard>

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
        v-if="canUploadPhoto"
        :upload-url="`/api/ideas/${route.params.id}/media`"
        class="mt-4"
        @uploaded="refresh"
      />
    </UCard>

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
          class="flex items-start justify-between gap-2 py-3 text-sm"
        >
          <div>
            <p class="text-xs font-medium text-muted">
              {{ comment.authorName }} · {{ new Date(comment.createdAt).toLocaleDateString('es-ES') }}
            </p>
            <p>{{ comment.body }}</p>
          </div>
          <UButton
            v-if="currentUserRole === 'admin'"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="deleteComment(comment.id)"
          />
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

    <ReferenceLinksCard :base-url="`/api/ideas/${route.params.id}`" />
  </div>
</template>
