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
      // Dos secciones para que no se confundan los dos mundos financieros: los gastos
      // repartidos entre miembros (libro contable) y la cuenta bancaria real (banco).
      // El popover horizontal de UNavigationMenu no anida nietos: la separación va con
      // ítems type 'label' (cabecera estática) dentro del mismo desplegable. Las clases
      // completas y literales (sin interpolación) son requisito de detección de Tailwind.
      { label: 'Gastos', type: 'label', class: 'nav-section-label' },
      { label: 'Libro contable', description: 'Recibos y gastos repartidos entre miembros', icon: 'i-lucide-book-open', to: '/ledger' },
      { label: 'Central de gastos', description: 'Tus deudas y pagos pendientes', icon: 'i-lucide-chart-pie', to: '/dashboard' },
      { label: 'Liquidación', description: 'Deudas cruzadas por los gastos (opción de incluir el banco)', icon: 'i-lucide-arrow-left-right', to: '/liquidacion' },
      { label: 'Estadísticas', description: 'Evolución del gasto y por persona', icon: 'i-lucide-bar-chart-3', to: '/estadisticas' },
      { label: 'Exportar', description: 'Exportación fiscal de los gastos', icon: 'i-lucide-download', to: '/export' },
      { label: 'Cuenta bancaria', type: 'label', class: 'nav-section-label nav-section-divider' },
      { label: 'Cuenta bancaria', description: 'Movimientos y saldo real del banco', icon: 'i-lucide-landmark', to: '/banco' },
      { label: 'Contribuciones', description: 'Cuotas, aportes y conciliación', icon: 'i-lucide-coins', to: '/banco/contribuciones' }
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
    <UHeader
      title="Finca La Unión"
      to="/"
    >
      <!-- ClientOnly: la sesión se resuelve en el cliente DESPUÉS del primer render (el
        fetch de get-session no viaja en el payload de SSR), así que el servidor pinta el
        header logueado y el cliente el deslogueado → hydration mismatch en cascada
        (nav, título, Entrar/Salir). Renderizando tras el montaje, ambos lados coinciden. -->
      <ClientOnly>
        <UNavigationMenu :items="navLinks" />
      </ClientOnly>

      <template #right>
        <ClientOnly>
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
        </ClientOnly>
      </template>

      <template #body>
        <ClientOnly>
          <UNavigationMenu
            :items="navLinks"
            orientation="vertical"
            class="-mx-2.5"
          />
        </ClientOnly>
      </template>
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
