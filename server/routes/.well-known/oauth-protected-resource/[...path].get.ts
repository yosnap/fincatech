// Variante con sufijo de ruta (RFC 9728 §3.1): para el recurso `/mcp`, los clientes MCP
// piden primero `/.well-known/oauth-protected-resource/mcp` y solo después la raíz.
export { default } from '../oauth-protected-resource.get'
