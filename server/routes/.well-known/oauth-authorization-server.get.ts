import { auth } from '../../utils/auth'

// Metadatos del authorization server (RFC 8414), en la raíz de la app: el recurso
// protegido declara `authorization_servers: [origen]` y el cliente resuelve
// `/.well-known/oauth-authorization-server` contra ese origen. El plugin `mcp` de Better
// Auth lo sirve también bajo `/api/auth/...`; esta ruta existe porque el discovery la
// resuelve contra el origen declarado.
export default defineEventHandler(async (event) => {
  const metadata = await auth.api.getMcpOAuthConfig({
    headers: event.headers
  })
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  })
  return metadata
})
