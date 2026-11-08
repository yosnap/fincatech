<script setup lang="ts">
// Pantalla de consentimiento OAuth 2.1 del servidor MCP (fase 4). El cliente remoto
// (claude.ai, Claude Desktop, Inspector) lanza el flujo y Better Auth redirige aquí con
// `consent_code` + `client_id` + `scope` cuando `prompt=consent`. Solo un Admin puede
// consentir: si llega otro rol, la pantalla lo avisa y solo puede denegar (el guard del
// authorize ya impide que un no-admin reciba consent_code en primer lugar).

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const query = {
  client_id: String(route.query.client_id ?? ''),
  scope: String(route.query.scope ?? '')
}

interface ConsentInfo {
  clientId: string
  clientName: string
  scope: string
  isAdmin: boolean
}

const { data: info } = await useFetch<ConsentInfo>('/api/mcp/consent', { query })

const busy = ref(false)

async function decide(accept: boolean) {
  if (busy.value) return
  busy.value = true
  try {
    const { redirectURI } = await $fetch<{ redirectURI: string }>('/api/auth/oauth2/consent', {
      method: 'POST',
      body: {
        accept,
        consent_code: String(route.query.consent_code ?? '')
      }
    })
    window.location.assign(redirectURI)
  } catch {
    // El code caducó (10 min) o ya se consumió: se avisa y se deja volver al origen.
    window.location.assign('/')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm py-10">
    <UCard v-if="info">
      <template #header>
        <h1 class="text-lg font-semibold">
          Acceso a Fincatech vía MCP
        </h1>
      </template>

      <div class="flex flex-col gap-4 text-sm">
        <UAlert
          v-if="!info.isAdmin"
          color="error"
          variant="soft"
          title="Solo los administradores pueden autorizar"
          description="Tu cuenta no tiene el rol de administrador, por lo que no puede conceder acceso a esta aplicación."
        />

        <div
          v-else
          class="flex flex-col gap-3"
        >
          <p
            class="text-muted"
          >
            La aplicación
          </p>
          <p class="text-base font-semibold">
            {{ info.clientName }}
          </p>
          <p
            v-if="info.scope"
            class="text-muted"
          >
            solicita acceso a:
            <code class="rounded bg-default px-1 text-xs">
              {{ info.scope }}
            </code>
          </p>
          <p
            v-if="info.scope"
            class="text-xs text-muted"
          >
            Podrá leer y modificar los datos de la finca (banco, gastos, tareas y reservas) como
            si lo hicieras tú, y cada operación queda auditada con su canal.
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex gap-3">
          <UButton
            color="neutral"
            variant="soft"
            class="flex-1"
            :loading="busy"
            @click="decide(false)"
          >
            Denegar
          </UButton>
          <UButton
            v-if="info.isAdmin"
            class="flex-1"
            :loading="busy"
            @click="decide(true)"
          >
            Permitir acceso
          </UButton>
        </div>
      </template>
    </UCard>

    <UCard
      v-else
      class="p-6"
    >
      <p class="text-sm text-muted">
        No se pudo leer la solicitud de acceso. Si el paso caducó, vuelve a iniciar la conexión
        desde la aplicación.
      </p>
    </UCard>
  </div>
</template>
