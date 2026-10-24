import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { SESSION_ABSOLUTE_MS, validateSession } from '../auth/sessions'
import { siteMembers, sites, type User } from '../db/schema'
import type { AppEnv, AuthedEnv } from '../env'

export function sessionCookieName(secure: boolean) {
  // The __Host- prefix pins the cookie to this exact origin (no Domain, Path=/, Secure).
  return secure ? '__Host-drikus_session' : 'drikus_session'
}

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  const { secureCookies } = c.var.deps.config
  setCookie(c, sessionCookieName(secureCookies), token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  })
}

export function clearSessionCookie(c: Context<AppEnv>) {
  const { secureCookies } = c.var.deps.config
  deleteCookie(c, sessionCookieName(secureCookies), { path: '/', secure: secureCookies })
}

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, sessionCookieName(c.var.deps.config.secureCookies))
  const session = token ? validateSession(c.var.deps.db, token) : null
  c.set('user', session?.user ?? null)
  c.set('sessionHash', session?.tokenHash ?? null)
  if (token && !session) clearSessionCookie(c)
  await next()
})

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF protection for the JSON API: state-changing requests must carry a custom
 * header (which cross-site forms can't send and cross-origin fetches can't send
 * without a CORS preflight we never approve) and, when present, a same-origin
 * Origin / Sec-Fetch-Site.
 */
export const csrf = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin')
    const fetchSite = c.req.header('sec-fetch-site')
    const okOrigin = !origin || origin === c.var.deps.config.publicOrigin
    const okSite = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
    if (c.req.header('x-drikus-csrf') !== '1' || !okOrigin || !okSite) {
      return c.json({ error: 'csrf' as const }, 403)
    }
  }
  await next()
})

export const requireUser = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.var.user || !c.var.sessionHash) return c.json({ error: 'unauthenticated' as const }, 401)
  await next()
})

export function mustEnableTotp(user: User, requireAdminTotp: boolean) {
  return requireAdminTotp && user.role === 'superadmin' && !user.totpSecretEnc
}

export const requireSuperadmin = createMiddleware<AuthedEnv>(async (c, next) => {
  const user = c.var.user
  if (!user || !c.var.sessionHash) return c.json({ error: 'unauthenticated' as const }, 401)
  if (user.role !== 'superadmin') return c.json({ error: 'forbidden' as const }, 403)
  if (mustEnableTotp(user, c.var.deps.config.requireAdminTotp)) {
    return c.json({ error: 'totp_required' as const }, 403)
  }
  await next()
})

export function canAccessSite(c: Context<AuthedEnv>, siteId: string): boolean {
  const { user, deps } = c.var
  if (user.role === 'superadmin') {
    return !!deps.db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)).get()
  }
  return !!deps.db
    .select({ siteId: siteMembers.siteId })
    .from(siteMembers)
    .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.userId, user.id)))
    .get()
}

/**
 * Guards every `/sites/:siteId/*` route. Unknown and forbidden sites both
 * return 404 so editors can't probe which sites exist.
 */
export const requireSiteAccess = createMiddleware<AuthedEnv>(async (c, next) => {
  const siteId = c.req.param('siteId')
  if (!siteId || !canAccessSite(c, siteId)) return c.json({ error: 'not_found' as const }, 404)
  await next()
})
