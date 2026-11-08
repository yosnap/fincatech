import { auth } from '../../utils/auth'

// Metadatos RFC 9728 del recurso protegido, en la raíz de la app: los clientes MCP
// (claude.ai, Claude Desktop, Inspector) resuelven `/.well-known/oauth-protected-resource`
// relativo a la URL del recurso (`/mcp`) para descubrir el authorization server. El plugin
// `mcp` de Better Auth lo sirve también bajo `/api/auth/...`; esta ruta existe porque el
// spec la resuelve contra el recurso, no contra el basePath de auth.
export default defineEventHandler(async (event) => {
  const metadata = await auth.api.getMCPProtectedResource({
    headers: event.headers
  })
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  })
  return metadata
})
