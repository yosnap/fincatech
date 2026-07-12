<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  const { error } = await authClient.signIn.email({
    email: email.value,
    password: password.value
  })
  loading.value = false
  if (error) {
    errorMessage.value = 'Email o contraseña incorrectos'
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <div class="mx-auto max-w-sm py-10">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          Iniciar sesión
        </h1>
      </template>

      <form
        class="flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Contraseña">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
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
          block
          :loading="loading"
        >
          Entrar
        </UButton>
      </form>
    </UCard>
  </div>
</template>
