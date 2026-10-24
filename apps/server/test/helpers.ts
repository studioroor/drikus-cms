import { eq } from 'drizzle-orm'
import { TOTP } from 'otpauth'
import { createApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { makeConfig } from '../src/config'
import { openDb } from '../src/db'
import { type Role, siteMembers, sites, users } from '../src/db/schema'
import { createLimiters, type Deps } from '../src/env'
import { GitHubApp } from '../src/github/app'
import { SecretBox } from '../src/lib/crypto'
import type { FakeGitHub } from './fake-github'

export const ORIGIN = 'http://cms.test'
export const PASSWORD = 'correct horse battery'

export const WEBHOOK_SECRET = 'test-webhook-secret'

/** A GitHubApp wired to an in-memory fake GitHub API. */
export function githubFor(fake: FakeGitHub, opts: { webhookSecret?: string } = {}) {
  return new GitHubApp({
    appId: fake.appId,
    privateKey: fake.privateKey,
    org: fake.org,
    webhookSecret: opts.webhookSecret ?? WEBHOOK_SECRET,
    fetch: fake.fetch,
  })
}

export function setup(overrides: Partial<Deps['config']> = {}, github: GitHubApp | null = null) {
  const deps: Deps = {
    db: openDb(':memory:'),
    config: makeConfig(ORIGIN, overrides),
    box: new SecretBox(Buffer.alloc(32, 7)),
    limiters: createLimiters(),
    github,
  }
  const app = createApp(deps)

  /** Minimal cookie-jar client that behaves like the SPA. */
  function client() {
    let cookie = ''
    async function request(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const res = await app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-drikus-csrf': '1',
          origin: ORIGIN,
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) {
        const pair = setCookie.split(';')[0] ?? ''
        cookie = pair.endsWith('=') ? '' : pair
      }
      // biome-ignore lint/suspicious/noExplicitAny: tests assert on loosely typed JSON bodies
      const json = (await res.json().catch(() => null)) as Record<string, any>
      return { status: res.status, json, headers: res.headers }
    }
    return {
      get: (path: string) => request('GET', path),
      post: (path: string, body?: unknown, headers?: Record<string, string>) =>
        request('POST', path, body ?? {}, headers),
      patch: (path: string, body: unknown) => request('PATCH', path, body),
      put: (path: string, body: unknown) => request('PUT', path, body),
      del: (path: string) => request('DELETE', path),
      request,
      get cookie() {
        return cookie
      },
    }
  }

  async function createUser(opts: {
    email: string
    role?: Role
    totpSecret?: string
    siteIds?: string[]
  }) {
    const user = deps.db
      .insert(users)
      .values({
        email: opts.email,
        name: opts.email.split('@')[0] as string,
        role: opts.role ?? 'editor',
        passwordHash: await hashPassword(PASSWORD),
        totpSecretEnc: opts.totpSecret ? deps.box.encrypt(opts.totpSecret) : null,
      })
      .returning()
      .get()
    for (const siteId of opts.siteIds ?? [])
      deps.db.insert(siteMembers).values({ siteId, userId: user.id }).run()
    return user
  }

  function createSite(name: string) {
    return deps.db.insert(sites).values({ name }).returning().get()
  }

  function getUser(id: string) {
    return deps.db.select().from(users).where(eq(users.id, id)).get()
  }

  return { deps, app, client, createUser, createSite, getUser }
}

export const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

export function totpCode(secret: string, timestamp = Date.now()) {
  return new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp })
}

/** Signs in a superadmin with 2FA enabled. */
export async function adminClient(ctx: ReturnType<typeof setup>) {
  await ctx.createUser({
    email: 'admin@test.nl',
    role: 'superadmin',
    totpSecret: ADMIN_TOTP_SECRET,
  })
  const admin = ctx.client()
  const res = await admin.post('/api/auth/login', {
    email: 'admin@test.nl',
    password: PASSWORD,
    code: totpCode(ADMIN_TOTP_SECRET),
  })
  if (res.json.status !== 'ok') throw new Error(`admin login failed: ${JSON.stringify(res.json)}`)
  return admin
}

export function tokenFromLink(link: string) {
  return link.split('#')[1] as string
}
