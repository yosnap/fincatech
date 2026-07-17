<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/utils/auth-client'

// useSession(useFetch), no la variante reactiva sin argumentos: esta última no resuelve
// URLs relativas en SSR y produce un flash/mismatch de hidratación en la navegación.
const { data: session } = await authClient.useSession(useFetch)

// Agrupado por categoría (Finanzas / Gobernanza / Inmueble / Cuenta) en vez de una lista
// plana de 10-12 enlaces — en escritorio se renderizan como desplegables, en móvil como
// secciones dentro del menú (#body de UHeader).
const navLinks = computed<NavigationMenuItem[]>(() => {
  const links: NavigationMenuItem[] = [{ label: 'Inicio', icon: 'i-lucide-house', to: '/' }]
  if (!session.value) return links

  links.push({
    label: 'Finanzas',
    icon: 'i-lucide-wallet',
    children: [
      { label: 'Libro contable', icon: 'i-lucide-book-open', to: '/ledger' },
      { label: 'Central de gastos', icon: 'i-lucide-chart-pie', to: '/dashboard' },
      { label: 'Exportar', icon: 'i-lucide-download', to: '/export' }
    ]
  })
  links.push({
    label: 'Gobernanza',
    icon: 'i-lucide-vote',
    children: [
      { label: 'Ideas', icon: 'i-lucide-lightbulb', to: '/ideas' },
      { label: 'Propuestas', icon: 'i-lucide-file-check', to: '/proposals' }
    ]
  })
  links.push({ label: 'Tareas', icon: 'i-lucide-list-checks', to: '/tasks' })
  links.push({
    label: 'Inmueble',
    icon: 'i-lucide-image',
    children: [
      { label: 'Galería', icon: 'i-lucide-image', to: '/gallery' },
      { label: 'Calendario', icon: 'i-lucide-calendar', to: '/calendar' }
    ]
  })

  const accountChildren = [{ label: 'Mi perfil', icon: 'i-lucide-user', to: '/profile' }]
  if (session.value.user.role === 'admin') {
    accountChildren.push({ label: 'Miembros', icon: 'i-lucide-users', to: '/members' })
    accountChildren.push({ label: 'Papelera', icon: 'i-lucide-trash-2', to: '/admin/trash' })
  }
  links.push({ label: 'Cuenta', icon: 'i-lucide-circle-user', children: accountChildren })

  return links
})
</script>

<template>
  <div>
    <UHeader>
      <template #title>
        <NuxtLink
          to="/"
          class="font-semibold"
        >
          Finca La Unión
        </NuxtLink>
      </template>

      <UNavigationMenu :items="navLinks" />

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

      <template #body>
        <UNavigationMenu
          :items="navLinks"
          orientation="vertical"
          class="-mx-2.5"
        />
      </template>
    </UHeader>

    <UMain class="mx-auto w-full max-w-screen-sm px-4 py-6 sm:max-w-screen-md">
      <UAlert
        v-if="session?.user?.pendingApproval"
        color="warning"
        variant="soft"
        class="mb-4"
        title="Tu cuenta está pendiente de aprobación"
        description="Un administrador debe revisar tu registro. Mientras tanto, tu acceso es de solo lectura."
      />
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
