import { withMcpAuth } from 'better-auth/plugins'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { auth } from '../utils/auth'
import { db } from '../db/client'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'
import { checkRateLimit } from '../utils/rate-limit'
import { createMcpServer } from '../tools/mcp-server'

// Servidor MCP remoto (fase 4): expone el registro único de herramientas
// (server/tools/registry.ts) por Streamable HTTP en estado SIN sesión por petición.
// Autenticación: OAuth 2.1 — Better Auth es el authorization server (plugin `mcp`) y esta
// ruta el resource server. `withMcpAuth` comprueba el access token y devuelve 401 con
// `WWW-Authenticate` apuntando a los metadatos del recurso protegido cuando falta o caducó.
// El rol se vuelve a comprobar en cada petición leyendo la fila del usuario: un admin
// degradado o dado de baja pierde acceso al instante, aunque su token siga vivo.

const RATE_LIMIT = { max: 120, windowMs: 10 * 60 * 1000 }

// Errores de protocolo con el envoltorio JSON-RPC que el spec MCP espera en /mcp.
function protocolError(status: number, message: string): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'Access-Control-Expose-Headers': 'WWW-Authenticate' } }
  )
}

export default defineEventHandler(async (event) => {
  // Preflight CORS: el inspector MCP (y posibles clientes embebidos) llegan desde el
  // navegador; el resto de clientes llama desde su propio proceso sin CORS.
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
      'Access-Control-Expose-Headers': 'WWW-Authenticate'
    })
    return null
  }

  // Modo stateless: solo POST con mensajes JSON-RPC. GET (stream SSE) y DELETE (fin de
  // sesión) no aplican porque no hay sesiones.
  if (event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'POST, OPTIONS')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  // Cabeceras CORS en el res de Node: las heredan la respuesta del transport y la del guard.
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'WWW-Authenticate'
  })

  const { req, res } = event.node ?? {}
  if (!req || !res) {
    throw createError({ statusCode: 500, statusMessage: 'Node runtime required' })
  }

  // `withMcpAuth` trabaja con un Request web; solo le importan las cabeceras
  // (Authorization: Bearer), no el cuerpo.
  const request = new Request(`http://localhost${event.path}`, {
    method: 'POST',
    headers: new Headers(event.headers)
  })

  // La respuesta del guard (401/403) se copía al res de Node; si el transport ya escribió
  // la respuesta JSON-RPC, el res de Node es la respuesta real y el del guard se descarta.
  const guard = withMcpAuth(auth, async (_authRequest, mcpSession) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, mcpSession.userId))
    if (!user) {
      return protocolError(401, 'El usuario que poseía este token ya no existe')
    }
    if (!checkRateLimit(`mcp:${user.id}`, RATE_LIMIT)) {
      return protocolError(429, 'Demasiadas peticiones: espera y reintenta')
    }

    // El actor se cierra aquí y `runTool` lo re-verifica en cada herramienta (admin,
    // no banned) — nunca se acepta un actor aportado por el cliente.
    // Una cuenta pendiente de aprobación nunca actúa, aunque tuviera rol (defensa en profundidad).
    const server = createMcpServer({ id: user.id, role: user.role, banned: user.banned || user.pendingApproval })
    const transport = new StreamableHTTPServerTransport({
      // Stateless: sin sessionIdGenerator no se emite Mcp-Session-Id.
      sessionIdGenerator: undefined,
      // Los clientes remotos (claude.ai, Claude Desktop) no mantienen stream SSE.
      enableJsonResponse: true
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
      return new Response(null, { status: 204 })
    } finally {
      await server.close().catch(() => {})
    }
  })

  const response = await guard(request)

  if (res.writableEnded) {
    // El transport escribió la respuesta JSON-RPC en el res de Node.
    return
  }
  res.writeHead(response.status, Object.fromEntries(response.headers))
  // `res.end` de Node no acepta ArrayBuffer: lanzaría con las cabeceras ya enviadas y la
  // petición quedaría colgada sin respuesta.
  res.end(Buffer.from(await response.arrayBuffer()))
})
