<script setup lang="ts">
// Sección «Aplicaciones conectadas (MCP)» del perfil del Admin (fase 4): lista los clientes
// OAuth registrados contra el servidor MCP y revoca cualquiera borrando su aplicación (los
// tokens caen por cascade). Solo se monta en /profile cuando el rol es admin.

interface McpClient {
  id: string
  clientId: string
  name: string
  type: string
  redirectUrls: string[]
  disabled: boolean
  registeredAt: string
  activeTokens: number
}

const { data, refresh } = await useFetch<{ clients: McpClient[] }>('/api/admin/mcp-clients', {
  default: () => ({ clients: [] })
})

const revoking = ref<string | null>(null)

async function revoke(client: McpClient) {
  const confirmed = await useConfirmDialog()({
    title: `Revocar acceso de «${client.name}»`,
    description: 'La aplicación perderá el acceso al servidor MCP al momento y todos sus tokens quedarán revocados.',
    confirmLabel: 'Revocar'
  })
  if (!confirmed) return
  revoking.value = client.id
  try {
    await $fetch(`/api/admin/mcp-clients/${client.id}`, { method: 'DELETE' })
    await refresh()
  } finally {
    revoking.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p
      v-if="!data?.clients?.length"
      class="text-sm text-muted"
    >
      Aún no hay aplicaciones MCP conectadas.
    </p>

    <div
      v-for="client in data?.clients ?? []"
      :key="client.id"
      class="flex items-center justify-between gap-3 rounded-lg border border-default p-3"
    >
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          {{ client.name }}
        </p>
        <p class="text-xs text-muted">
          {{ client.type === 'public' ? 'Pública' : 'Confidencial' }} · {{ client.activeTokens }} token(s) activo(s)
        </p>
      </div>
      <UButton
        color="error"
        variant="soft"
        size="sm"
        :loading="revoking === client.id"
        @click="revoke(client)"
      >
        Revocar
      </UButton>
    </div>
  </div>
</template>
