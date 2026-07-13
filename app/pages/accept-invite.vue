<script setup lang="ts">
const route = useRoute()
const token = computed(() => String(route.query.token ?? ''))

const toast = useToast()
const name = ref('')
const password = ref('')
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  try {
    await $fetch('/api/auth/accept-invite', {
      method: 'POST',
      body: { token: token.value, name: name.value, password: password.value }
    })
    toast.add({ title: 'Cuenta creada correctamente', color: 'success' })
    await navigateTo('/')
  } catch {
    toast.add({ title: 'No se pudo aceptar la invitación. Puede que el enlace haya caducado.', color: 'error' })
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
