<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

const { data: session } = await authClient.useSession(useFetch)

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  owner: 'Propietario',
  guest: 'Invitado'
}

interface Preferences {
  telegramEnabled: boolean
  emailEnabled: boolean
}

const { data: prefs, refresh: refreshPrefs } = await useFetch<Preferences>('/api/notifications/preferences')
const { data: telegramStatus, refresh: refreshTelegramStatus } = await useFetch<{ linked: boolean }>('/api/telegram/status')

const linkToken = ref('')
const linkError = ref('')
const generatingToken = ref(false)
const savingPrefs = ref(false)

async function generateLinkToken() {
  linkError.value = ''
  generatingToken.value = true
  try {
    const result = await $fetch<{ token: string }>('/api/telegram/link', { method: 'POST' })
    linkToken.value = result.token
  } catch {
    linkError.value = 'No se pudo generar el token de vinculación'
  } finally {
    generatingToken.value = false
  }
}

async function savePreferences(telegramEnabled: boolean, emailEnabled: boolean) {
  savingPrefs.value = true
  try {
    await $fetch('/api/notifications/preferences', {
      method: 'PATCH',
      body: { telegramEnabled, emailEnabled }
    })
    await refreshPrefs()
  } finally {
    savingPrefs.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-sm flex-col gap-6 py-10">
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

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Notificaciones
        </h2>
      </template>

      <div class="flex flex-col gap-4">
        <UCheckbox
          :model-value="prefs?.emailEnabled ?? true"
          label="Email"
          :disabled="savingPrefs"
          @update:model-value="(checked) => savePreferences(prefs?.telegramEnabled ?? false, checked === true)"
        />

        <UCheckbox
          :model-value="prefs?.telegramEnabled ?? false"
          label="Telegram"
          :disabled="savingPrefs || !telegramStatus?.linked"
          @update:model-value="(checked) => savePreferences(checked === true, prefs?.emailEnabled ?? true)"
        />

        <p
          v-if="!telegramStatus?.linked"
          class="text-sm text-muted"
        >
          Telegram no está vinculado todavía.
        </p>

        <UButton
          v-if="!telegramStatus?.linked"
          variant="soft"
          :loading="generatingToken"
          @click="generateLinkToken"
        >
          Generar token de vinculación
        </UButton>

        <UAlert
          v-if="linkToken"
          color="success"
          variant="soft"
          title="Envía este mensaje a nuestro bot de Telegram:"
          :description="`/link ${linkToken}`"
        />
        <UAlert
          v-if="linkError"
          color="error"
          variant="soft"
          :title="linkError"
        />
        <UButton
          v-if="linkToken"
          variant="link"
          size="xs"
          @click="() => refreshTelegramStatus()"
        >
          Ya lo envié — comprobar vinculación
        </UButton>
      </div>
    </UCard>
  </div>
</template>
