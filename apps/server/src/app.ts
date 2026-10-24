import { type Context, Hono } from 'hono'
import { getConnInfo } from 'hono/bun'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv, Deps } from './env'
import { csrf, loadSession } from './middleware/auth'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { githubWebhookRoutes } from './routes/github-webhook'
import { siteRoutes } from './routes/sites'

function clientIp(c: Context<AppEnv>, trustProxy: boolean) {
  if (trustProxy) {
    // Proxies append the address they saw. Earlier entries come from the
    // client and can be anything, so only the last one (our proxy's) counts.
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c as unknown as Context).remote.address ?? 'unknown'
  } catch {
    // Not running under Bun.serve (e.g. in tests).
    return 'unknown'
  }
}

const api = new Hono<AppEnv>()
  .route('/auth', authRoutes)
  .route('/sites', siteRoutes)
  .route('/admin', adminRoutes)

export type AppType = typeof api

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.use(async (c, next) => {
    c.set('deps', deps)
    c.set('ip', clientIp(c, deps.config.trustProxy))
    await next()
    // Runs after secureHeaders below, so a route can tighten the policy for its response.
    if (c.var.csp) c.res.headers.set('content-security-policy', c.var.csp)
  })
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
      strictTransportSecurity: deps.config.secureCookies ? 'max-age=31536000' : false,
    }),
  )

  app.get('/api/health', (c) => c.json({ ok: true }))
  // Authenticated by HMAC signature instead of a session, so it skips CSRF/session checks.
  app.route('/api/github/webhook', githubWebhookRoutes)
  app.use('/api/*', async (c, next) => {
    await next()
    // API data is never cached, unless a route chose otherwise (e.g. content-addressed files).
    if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store')
  })
  app.use('/api/*', csrf, loadSession)
  app.route('/api', api)
  app.all('/api/*', (c) => c.json({ error: 'not_found' as const }, 404))

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'internal' as const }, 500)
  })

  return app
}
