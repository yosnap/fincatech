<script setup lang="ts">
const toast = useToast()
const name = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  try {
    await $fetch('/api/auth/self-register', {
      method: 'POST',
      body: { email: email.value, password: password.value, name: name.value }
    })
    toast.add({ title: 'Cuenta creada. Un administrador debe aprobarla para darte acceso completo.', color: 'success' })
    await navigateTo('/')
  } catch {
    toast.add({ title: 'No se pudo crear la cuenta (puede que el email ya esté registrado)', color: 'error' })
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
          Crear cuenta
        </h1>
      </template>

      <UAlert
        color="neutral"
        variant="soft"
        class="mb-4"
        title="Acceso pendiente de aprobación"
        description="Al registrarte, un administrador debe aprobar tu cuenta antes de que tengas acceso completo."
      />

      <form
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
            autocomplete="new-password"
            required
            minlength="8"
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

        <UButton
          type="submit"
          block
          :loading="loading"
        >
          Crear cuenta
        </UButton>
      </form>

      <template #footer>
        <p class="text-center text-sm text-muted">
          ¿Ya tienes cuenta? <NuxtLink
            to="/login"
            class="text-primary hover:underline"
          >Inicia sesión</NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
