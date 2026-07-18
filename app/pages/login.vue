<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const toast = useToast()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(true)
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  const { error } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
    rememberMe: rememberMe.value
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
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <UCheckbox
          v-model="rememberMe"
          label="Mantener sesión iniciada"
        />

        <UButton
          type="submit"
          block
          :loading="loading"
        >
          Entrar
        </UButton>
      </form>

      <template #footer>
        <p class="text-center text-sm text-muted">
          ¿No tienes cuenta? <NuxtLink
            to="/register"
            class="text-primary hover:underline"
          >Regístrate</NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
