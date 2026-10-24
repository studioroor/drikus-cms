import { describe, expect, test } from 'bun:test'
import { createAuthToken } from '../src/auth/tokens'
import {
  ADMIN_TOTP_SECRET,
  adminClient,
  ORIGIN,
  PASSWORD,
  setup,
  tokenFromLink,
  totpCode,
} from './helpers'

describe('login', () => {
  test('signs in with valid credentials and sets an HttpOnly cookie', async () => {
    const ctx = setup()
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const c = ctx.client()
    const res = await c.post('/api/auth/login', { email: 'Anna@Bakkerij.nl ', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.json.user.email).toBe('anna@bakkerij.nl')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect((await c.get('/api/auth/me')).json.user.email).toBe('anna@bakkerij.nl')
  })

  test('uses a __Host- secure cookie on https', async () => {
    const ctx = setup({ secureCookies: true })
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const res = await ctx
      .client()
      .post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toStartWith('__Host-drikus_session=')
    expect(cookie).toContain('Secure')
  })

  test('does not reveal whether an account exists', async () => {
    const ctx = setup()
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const wrongPw = await ctx
      .client()
      .post('/api/auth/login', { email: 'anna@bakkerij.nl', password: 'nope-nope-nope' })
    const noUser = await ctx
      .client()
      .post('/api/auth/login', { email: 'ghost@bakkerij.nl', password: 'nope-nope-nope' })
    expect(wrongPw.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(wrongPw.json).toEqual(noUser.json)
  })

  test('locks an account after repeated failures', async () => {
    const ctx = setup()
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const c = ctx.client()
    for (let i = 0; i < 5; i++)
      await c.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: 'wrong-password' })
    const res = await c.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    expect(res.status).toBe(429)
  })

  test('rejects disabled users', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const user = await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const anna = ctx.client()
    await anna.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    await admin.patch(`/api/admin/users/${user.id}`, { disabled: true })
    expect((await anna.get('/api/auth/me')).json.user).toBeNull()
    const res = await ctx
      .client()
      .post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    expect(res.status).toBe(401)
  })

  test('logout revokes the session server-side', async () => {
    const ctx = setup()
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const c = ctx.client()
    await c.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    const stolen = c.cookie
    await c.post('/api/auth/logout')
    const res = await ctx.app.request('/api/auth/me', { headers: { cookie: stolen } })
    expect(((await res.json()) as { user: unknown }).user).toBeNull()
  })
})

describe('two-factor auth', () => {
  test('requires a code when enabled and rejects replayed codes', async () => {
    const ctx = setup()
    await ctx.createUser({
      email: 'admin@test.nl',
      role: 'superadmin',
      totpSecret: ADMIN_TOTP_SECRET,
    })
    const step1 = await ctx
      .client()
      .post('/api/auth/login', { email: 'admin@test.nl', password: PASSWORD })
    expect(step1.json.status).toBe('totp_required')
    expect(step1.headers.get('set-cookie')).toBeNull()

    const code = totpCode(ADMIN_TOTP_SECRET)
    const ok = await ctx
      .client()
      .post('/api/auth/login', { email: 'admin@test.nl', password: PASSWORD, code })
    expect(ok.json.status).toBe('ok')
    const replay = await ctx
      .client()
      .post('/api/auth/login', { email: 'admin@test.nl', password: PASSWORD, code })
    expect(replay.status).toBe(401)
  })

  test('superadmins must enable 2FA before using admin routes', async () => {
    const ctx = setup()
    await ctx.createUser({ email: 'admin@test.nl', role: 'superadmin' })
    const c = ctx.client()
    const login = await c.post('/api/auth/login', { email: 'admin@test.nl', password: PASSWORD })
    expect(login.json.user.mustEnableTotp).toBe(true)
    expect((await c.get('/api/admin/users')).json.error).toBe('totp_required')

    const setupRes = await c.post('/api/auth/totp/setup', { password: PASSWORD })
    expect(setupRes.json.uri).toStartWith('otpauth://totp/')
    const bad = await c.post('/api/auth/totp/enable', { code: '000000' })
    expect(bad.status).toBe(400)
    const enabled = await c.post('/api/auth/totp/enable', { code: totpCode(setupRes.json.secret) })
    expect(enabled.json.user.totpEnabled).toBe(true)
    expect((await c.get('/api/admin/users')).status).toBe(200)

    const disable = await c.post('/api/auth/totp/disable', { password: PASSWORD, code: '123456' })
    expect(disable.json.error).toBe('totp_mandatory')
  })

  test('stores TOTP secrets encrypted', async () => {
    const ctx = setup()
    const user = await ctx.createUser({
      email: 'admin@test.nl',
      role: 'superadmin',
      totpSecret: ADMIN_TOTP_SECRET,
    })
    expect(ctx.getUser(user.id)?.totpSecretEnc).not.toContain(ADMIN_TOTP_SECRET)
  })
})

describe('invite and reset links', () => {
  test('invite link sets a password once and signs the user in', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const created = await admin.post('/api/admin/users', { email: 'piet@kapper.nl', name: 'Piet' })
    expect(created.status).toBe(201)
    expect(created.json.link).toStartWith(`${ORIGIN}/invite#`)
    const token = tokenFromLink(created.json.link)

    const piet = ctx.client()
    const inspect = await piet.post('/api/auth/token/inspect', { token })
    expect(inspect.json).toEqual({ type: 'invite', email: 'piet@kapper.nl', name: 'Piet' })
    const accept = await piet.post('/api/auth/token/accept', {
      token,
      password: 'a-good-long-password',
    })
    expect(accept.json.status).toBe('ok')
    expect((await piet.get('/api/auth/me')).json.user.email).toBe('piet@kapper.nl')

    const again = await ctx
      .client()
      .post('/api/auth/token/accept', { token, password: 'another-password!' })
    expect(again.status).toBe(404)
  })

  test('rejects short passwords', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const created = await admin.post('/api/admin/users', { email: 'piet@kapper.nl', name: 'Piet' })
    const res = await ctx.client().post('/api/auth/token/accept', {
      token: tokenFromLink(created.json.link),
      password: 'short',
    })
    expect(res.status).toBe(400)
  })

  test('a new link invalidates the previous one', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const created = await admin.post('/api/admin/users', { email: 'piet@kapper.nl', name: 'Piet' })
    const fresh = await admin.post(`/api/admin/users/${created.json.id}/link`)
    expect(fresh.json.type).toBe('invite')
    const old = await ctx
      .client()
      .post('/api/auth/token/inspect', { token: tokenFromLink(created.json.link) })
    expect(old.status).toBe(404)
  })

  test('reset revokes existing sessions and never bypasses 2FA', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const user = await ctx.createUser({ email: 'anna@bakkerij.nl', totpSecret: ADMIN_TOTP_SECRET })
    const link = await admin.post(`/api/admin/users/${user.id}/link`)
    expect(link.json.type).toBe('reset')
    const res = await ctx.client().post('/api/auth/token/accept', {
      token: tokenFromLink(link.json.link),
      password: 'brand-new-password',
    })
    expect(res.json.status).toBe('login_required')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('first-run setup link creates the superadmin once', async () => {
    const ctx = setup()
    const token = createAuthToken(ctx.deps.db, { type: 'setup' })
    const c = ctx.client()
    const res = await c.post('/api/auth/token/accept', {
      token,
      email: 'Drikus@Example.com',
      name: 'Drikus',
      password: 'super-secret-pass',
    })
    expect(res.json.user).toMatchObject({
      email: 'drikus@example.com',
      role: 'superadmin',
      mustEnableTotp: true,
    })
    const token2 = createAuthToken(ctx.deps.db, { type: 'setup' })
    const second = await ctx.client().post('/api/auth/token/accept', {
      token: token2,
      email: 'evil@example.com',
      name: 'Evil',
      password: 'super-secret-pass',
    })
    expect(second.status).toBe(404)
  })
})

describe('csrf', () => {
  test('rejects mutations without the custom header', async () => {
    const ctx = setup()
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'a@b.nl', password: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  test('rejects mutations from another origin', async () => {
    const ctx = setup()
    const res = await ctx
      .client()
      .post(
        '/api/auth/login',
        { email: 'a@b.nl', password: 'x' },
        { origin: 'https://evil.example' },
      )
    expect(res.status).toBe(403)
    expect(res.json.error).toBe('csrf')
  })
})

describe('security headers', () => {
  test('sets CSP and frame protection', async () => {
    const ctx = setup()
    const res = await ctx.app.request('/api/auth/me')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
