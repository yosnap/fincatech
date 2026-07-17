<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

interface Member {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  pendingApproval: boolean
  createdAt: string
}

const ROLE_OPTIONS = [
  { label: 'Administrador', value: 'admin' },
  { label: 'Propietario', value: 'owner' },
  { label: 'Invitado', value: 'guest' }
]

const { data, refresh } = await useFetch<{ members: Member[] }>('/api/members')

// Auto-registrados pendientes de aprobación primero, para que el Admin los vea sin buscar.
const sortedMembers = computed(() => {
  const members = data.value?.members ?? []
  return [...members].sort((a, b) => Number(b.pendingApproval) - Number(a.pendingApproval))
})

const inviteEmail = ref('')
const inviteRole = ref('owner')
const inviteError = ref('')
const inviteLink = ref('')
const inviting = ref(false)

async function onInvite() {
  inviteError.value = ''
  inviteLink.value = ''
  inviting.value = true
  try {
    const result = await $fetch('/api/members/invite', {
      method: 'POST',
      body: { email: inviteEmail.value, role: inviteRole.value }
    })
    // El token solo viene en la respuesta cuando el email falló (ver server/api/members/invite.post.ts).
    if (!result.emailSent && result.invitation.token) {
      inviteLink.value = `${window.location.origin}/accept-invite?token=${result.invitation.token}`
    }
    inviteEmail.value = ''
    await refresh()
  } catch {
    inviteError.value = 'No se pudo crear la invitación'
  } finally {
    inviting.value = false
  }
}

async function onRoleChange(member: Member, role: string) {
  await $fetch(`/api/members/${member.id}/role`, { method: 'PATCH', body: { role } })
  await refresh()
}

async function onDeactivate(member: Member) {
  await $fetch(`/api/members/${member.id}/deactivate`, { method: 'POST' })
  await refresh()
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          Invitar miembro
        </h1>
      </template>

      <form
        class="flex flex-col gap-4 sm:flex-row sm:items-end"
        @submit.prevent="onInvite"
      >
        <UFormField
          label="Email"
          class="flex-1"
        >
          <UInput
            v-model="inviteEmail"
            type="email"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Rol">
          <USelect
            v-model="inviteRole"
            :items="ROLE_OPTIONS"
            class="w-40"
          />
        </UFormField>

        <UButton
          type="submit"
          :loading="inviting"
        >
          Invitar
        </UButton>
      </form>

      <UAlert
        v-if="inviteError"
        class="mt-4"
        color="error"
        variant="soft"
        :title="inviteError"
      />

      <UAlert
        v-if="inviteLink"
        class="mt-4"
        color="warning"
        variant="soft"
        title="Invitación creada, pero no se pudo enviar por email"
      >
        <template #description>
          <p>Copia este enlace y compártelo tú mismo con la persona invitada:</p>
          <p class="mt-1 break-all font-mono text-xs">
            {{ inviteLink }}
          </p>
        </template>
      </UAlert>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Miembros
        </h2>
      </template>

      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="member in sortedMembers"
          :key="member.id"
          class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p class="font-medium">
              {{ member.name }}
              <UBadge
                v-if="member.pendingApproval"
                color="warning"
                variant="soft"
                class="ml-2"
              >
                Pendiente de aprobación
              </UBadge>
              <UBadge
                v-if="member.banned"
                color="error"
                variant="soft"
                class="ml-2"
              >
                Baja
              </UBadge>
            </p>
            <p class="text-sm text-muted">
              {{ member.email }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="member.pendingApproval"
              color="success"
              size="sm"
              @click="onRoleChange(member, 'owner')"
            >
              Aprobar como Propietario
            </UButton>
            <USelect
              :model-value="member.role"
              :items="ROLE_OPTIONS"
              class="w-40"
              @update:model-value="(role) => onRoleChange(member, role as string)"
            />
            <UButton
              color="error"
              variant="soft"
              size="sm"
              :disabled="member.banned"
              @click="onDeactivate(member)"
            >
              Dar de baja
            </UButton>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
