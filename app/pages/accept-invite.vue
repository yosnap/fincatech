<script setup lang="ts">
const route = useRoute()
const token = computed(() => String(route.query.token ?? ''))

const name = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  try {
    await $fetch('/api/auth/accept-invite', {
      method: 'POST',
      body: { token: token.value, name: name.value, password: password.value }
    })
    await navigateTo('/')
  } catch {
    errorMessage.value = 'No se pudo aceptar la invitación. Puede que el enlace haya caducado.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm py-10">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          Completa tu registro
        </h1>
      </template>

      <UAlert
        v-if="!token"
        color="error"
        variant="soft"
        title="Enlace de invitación inválido"
      />

      <form
        v-else
        class="flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Nombre">
          <UInput
            v-model="name"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Contraseña">
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
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
          block
          :loading="loading"
        >
          Crear cuenta
        </UButton>
      </form>
    </UCard>
  </div>
</template>
