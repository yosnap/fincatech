<script setup lang="ts">
// Navegación condicionada por rol: placeholder hasta que exista sesión/RBAC (Fase 2).
const navLinks = [{ label: 'Inicio', to: '/' }]
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
