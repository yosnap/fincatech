<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

const { data: session } = await authClient.useSession(useFetch)

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  owner: 'Propietario',
  guest: 'Invitado'
}
</script>

<template>
  <div class="mx-auto max-w-sm py-10">
    <UCard v-if="session">
      <template #header>
        <h1 class="text-lg font-semibold">
          Mi perfil
        </h1>
      </template>

      <dl class="flex flex-col gap-3 text-sm">
        <div>
          <dt class="text-muted">
            Nombre
          </dt>
          <dd class="font-medium">
            {{ session.user.name }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            Email
          </dt>
          <dd class="font-medium">
            {{ session.user.email }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            Rol
          </dt>
          <dd>
            <UBadge variant="soft">
              {{ ROLE_LABELS[session.user.role ?? 'guest'] }}
            </UBadge>
          </dd>
        </div>
      </dl>

      <template #footer>
        <UButton
          color="neutral"
          variant="soft"
          @click="authClient.signOut({ fetchOptions: { onSuccess: () => { navigateTo('/login') } } })"
        >
          Cerrar sesión
        </UButton>
      </template>
    </UCard>
  </div>
</template>
