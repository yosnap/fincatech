<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const toast = useToast()
const email = ref('')
const password = ref('')
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  const { error } = await authClient.signIn.email({
    email: email.value,
    password: password.value
  })
  loading.value = false
  if (error) {
    toast.add({ title: 'Email o contraseña incorrectos', color: 'error' })
    return
  }
  toast.add({ title: 'Sesión iniciada', color: 'success' })
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
