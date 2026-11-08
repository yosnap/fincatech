import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb } from '../test/integration-db'

// Flujo OAuth 2.1 del servidor MCP de punta a punta contra Better Auth real (en proceso,
// vía auth.handler). Cubre las garantías que el plugin `mcp` no da por sí solo: el
// registro de clientes solo admite callbacks conocidos, el código nunca se emite sin
// pantalla de consentimiento y ningún usuario que no sea Admin activo canjea un token.
describeDb('OAuth del servidor MCP', () => {
  const suffix = randomUUID().slice(0, 8)
  const password = `Pw-${randomUUID()}`
  const adminEmail = `mcp-oauth-admin-${suffix}@example.test`
  const ownerEmail = `mcp-oauth-owner-${suffix}@example.test`
  const redirectUri = 'http://127.0.0.1:6274/oauth/callback'
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let auth: typeof import('../utils/auth').auth
  let base: string
  let clientId: string

  function cookieHeader(response: Response, previous = ''): string {
    const jar = new Map(previous.split('; ').filter(Boolean).map(pair => [pair.split('=')[0], pair]))
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0]!
      jar.set(pair.split('=')[0], pair)
    }
    return [...jar.values()].join('; ')
  }

  function call(path: string, init: { method?: string, body?: unknown, cookie?: string } = {}) {
    const headers: Record<string, string> = { origin: base }
    if (init.cookie) headers.cookie = init.cookie
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    return auth.handler(new Request(`${base}/api/auth${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual'
    }))
  }

  async function signIn(email: string, cookie = ''): Promise<{ response: Response, cookie: string }> {
    const response = await call('/sign-in/email', { method: 'POST', body: { email, password }, cookie })
    return { response, cookie: cookieHeader(response, cookie) }
  }

  function pkce() {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    return { verifier, challenge }
  }

  function authorizePath(challenge: string, extra = '') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
    return `/mcp/authorize?${params}${extra}`
  }

  function location(response: Response): string {
    return response.headers.get('location') ?? ''
  }

  async function exchange(code: string, verifier: string) {
    return auth.handler(new Request(`${base}/api/auth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'origin': base },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier
      })
    }))
  }

  beforeAll(async () => {
    client = await setupIntegrationDb()
    auth = (await import('../utils/auth')).auth
    base = process.env.BETTER_AUTH_URL!
    for (const [email, role] of [[adminEmail, 'admin'], [ownerEmail, 'owner']] as const) {
      await auth.api.createUser({ body: { email, password, name: `MCP ${role}`, role } })
    }
    const registered = await call('/mcp/register', {
      method: 'POST',
      body: { client_name: 'Inspector de prueba', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }
    })
    expect(registered.status).toBeLessThan(300)
    clientId = ((await registered.json()) as { client_id: string }).client_id
  })

  afterAll(async () => {
    if (!client) return
    const { schema } = client
    if (clientId) {
      await client.db.delete(schema.oauthApplication).where(inArray(schema.oauthApplication.clientId, [clientId]))
    }
    await client.db.delete(schema.users).where(inArray(schema.users.email, [adminEmail, ownerEmail]))
    await client.pool.end()
  })

  it('rechaza registrar un cliente con un callback que no es de Claude ni loopback', async () => {
    const response = await call('/mcp/register', {
      method: 'POST',
      body: { client_name: 'Malicioso', redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }
    })
    expect(response.status).toBe(400)
  })

  it('un Admin con sesión no recibe código sin pasar por la pantalla de consentimiento', async () => {
    const { cookie } = await signIn(adminEmail)
    const { challenge } = pkce()
    const response = await call(authorizePath(challenge), { cookie })
    expect(location(response)).not.toContain(redirectUri)
    expect(location(response)).not.toMatch(/[?&]code=/)
  })

  it('un Admin completa el flujo con consentimiento y obtiene un token válido', async () => {
    const { cookie } = await signIn(adminEmail)
    const { verifier, challenge } = pkce()
    const authorize = await call(authorizePath(challenge, '&prompt=consent'), { cookie })
    const consentUrl = new URL(location(authorize), base)
    expect(consentUrl.pathname).toBe('/oauth/consent')

    const consent = await call('/oauth2/consent', {
      method: 'POST',
      body: { accept: true, consent_code: consentUrl.searchParams.get('consent_code') },
      cookie
    })
    const { redirectURI } = (await consent.json()) as { redirectURI: string }
    const code = new URL(redirectURI).searchParams.get('code')
    expect(code).toBeTruthy()

    const token = await exchange(code!, verifier)
    expect(token.status).toBe(200)
    const { access_token: accessToken } = (await token.json()) as { access_token: string }
    const session = await auth.api.getMcpSession({ headers: new Headers({ authorization: `Bearer ${accessToken}` }) })
    expect(session?.userId).toBeTruthy()
  })

  it('un Propietario no obtiene token ni iniciando sesión dentro del flujo', async () => {
    const { verifier, challenge } = pkce()
    const anonymous = await call(authorizePath(challenge, '&prompt=consent'))
    const { response: login, cookie } = await signIn(ownerEmail, cookieHeader(anonymous))

    const urls = [location(login), location(await call(authorizePath(challenge, '&prompt=consent'), { cookie }))]
      .filter(Boolean)
      .map(url => new URL(url, base))
    const codes = urls.map(url => url.searchParams.get('code')).filter((code): code is string => Boolean(code))
    // Si el plugin le llevó a la pantalla de consentimiento, aceptar por API tampoco da código.
    for (const consentCode of urls.map(url => url.searchParams.get('consent_code')).filter(Boolean)) {
      const consent = await call('/oauth2/consent', { method: 'POST', body: { accept: true, consent_code: consentCode }, cookie })
      const redirect = consent.ok ? ((await consent.json()) as { redirectURI?: string }).redirectURI : undefined
      const code = redirect ? new URL(redirect).searchParams.get('code') : null
      if (code) codes.push(code)
    }
    for (const code of codes) {
      const token = await exchange(code, verifier)
      expect(token.status).not.toBe(200)
    }
  })
})
