<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

interface Props {
  // Ruta base de la entidad, p.ej. `/api/ideas/${id}` — el componente añade `/links`.
  baseUrl: string
}

const props = defineProps<Props>()

interface ReferenceLink {
  id: string
  url: string
  label: string | null
  addedBy: string
  createdAt: string
}

const { data, refresh } = await useFetch<{ links: ReferenceLink[] }>(`${props.baseUrl}/links`)

const session = authClient.useSession()
const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canAdd = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

function canDelete(link: ReferenceLink) {
  return currentUserRole.value === 'admin' || link.addedBy === currentUserId.value
}

const newUrl = ref('')
const newLabel = ref('')
const busy = ref(false)
const toast = useToast()

async function addLink() {
  busy.value = true
  try {
    await $fetch(`${props.baseUrl}/links`, {
      method: 'POST',
      body: { url: newUrl.value, label: newLabel.value || undefined }
    })
    newUrl.value = ''
    newLabel.value = ''
    await refresh()
    toast.add({ title: 'Enlace añadido', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo añadir el enlace (¿es una URL válida?)', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function removeLink(linkId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Borrar enlace',
    description: 'Se eliminará este enlace de referencia.',
    confirmLabel: 'Borrar',
    color: 'error'
  })
  if (!confirmed) return
  try {
    await $fetch(`${props.baseUrl}/links/${linkId}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Enlace borrado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo borrar el enlace', color: 'error' })
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">
        Enlaces
      </h2>
    </template>

    <div class="flex flex-col divide-y divide-default">
      <div
        v-for="link in data?.links ?? []"
        :key="link.id"
        class="flex items-center justify-between gap-2 py-2 text-sm"
      >
        <a
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="truncate text-primary hover:underline"
        >
          {{ link.label || link.url }}
        </a>
        <UButton
          v-if="canDelete(link)"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          @click="removeLink(link.id)"
        />
      </div>
      <p
        v-if="!(data?.links ?? []).length"
        class="py-2 text-center text-sm text-muted"
      >
        Sin enlaces todavía
      </p>
    </div>

    <div
      v-if="canAdd"
      class="mt-4 flex flex-col gap-2 sm:flex-row"
    >
      <UInput
        v-model="newUrl"
        placeholder="https://..."
        class="flex-1"
      />
      <UInput
        v-model="newLabel"
        placeholder="Texto (opcional)"
        class="sm:w-40"
      />
      <UButton
        :loading="busy"
        :disabled="!newUrl"
        @click="addLink"
      >
        Añadir
      </UButton>
    </div>
  </UCard>
</template>
