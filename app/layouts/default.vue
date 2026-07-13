<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

// useSession(useFetch), no la variante reactiva sin argumentos: esta última no resuelve
// URLs relativas en SSR y produce un flash/mismatch de hidratación en la navegación.
const { data: session } = await authClient.useSession(useFetch)

const navLinks = computed(() => {
  const links = [{ label: 'Inicio', to: '/' }]
  if (!session.value) return links
  links.push({ label: 'Libro contable', to: '/ledger' })
  links.push({ label: 'Ideas', to: '/ideas' })
  links.push({ label: 'Propuestas', to: '/proposals' })
  links.push({ label: 'Mi perfil', to: '/profile' })
  if (session.value.user.role === 'admin') {
    links.push({ label: 'Miembros', to: '/members' })
  }
  return links
})
</script>

<template>
  <div>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="font-semibold"
        >
          Finca La Unión
        </NuxtLink>
      </template>

      <template #right>
        <UButton
          v-if="!session"
          to="/login"
          variant="soft"
        >
          Entrar
        </UButton>
        <UButton
          v-else
          color="neutral"
          variant="ghost"
          @click="authClient.signOut({ fetchOptions: { onSuccess: () => { navigateTo('/login') } } })"
        >
          Salir
        </UButton>
        <UColorModeButton />
      </template>

      <UNavigationMenu :items="navLinks" />
    </UHeader>

    <UMain class="mx-auto w-full max-w-screen-sm px-4 py-6 sm:max-w-screen-md">
      <slot />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Finca La Unión © {{ new Date().getFullYear() }}
        </p>
      </template>
    </UFooter>
  </div>
</template>
