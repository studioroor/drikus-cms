import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from '../auth/password'
import { createSession, revokeSession, revokeUserSessions } from '../auth/sessions'
import { consumeToken, findValidToken } from '../auth/tokens'
import { checkTotp, generateTotpSecret, verifyUserTotp } from '../auth/totp'
import { LOCALES, users } from '../db/schema'
import type { AppEnv, AuthedEnv } from '../env'
import { audit } from '../lib/audit'
import { validate } from '../lib/http'
import { publicUser } from '../lib/serialize'
import { clearSessionCookie, requireUser, setSessionCookie } from '../middleware/auth'

const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
const code = z.string().trim().max(10)

const LoginBody = z.object({
  email: z.string().max(254),
  password: z.string().max(PASSWORD_MAX_LENGTH),
  code: code.optional(),
})

const AcceptBody = z.object({
  token: z.string().min(20).max(200),
  password,
  name: z.string().trim().min(1).max(100).optional(),
  // Only used for the first-run setup token, which has no user attached yet.
  email: email.optional(),
})

// Routes for signed-in users. `requireUser` is attached per route (not via
// `.use`) because this app is mounted at '/' next to the public auth routes.
const authed = new Hono<AuthedEnv>()
  .patch(
    '/me',
    requireUser,
    validate(
      'json',
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        locale: z.enum(LOCALES).optional(),
      }),
    ),
    (c) => {
      const { db, config } = c.var.deps
      const body = c.req.valid('json')
      const user = db
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, c.var.user.id))
        .returning()
        .get()
      return c.json({ user: publicUser(user, config.requireAdminTotp) })
    },
  )
  .post(
    '/password',
    requireUser,
    validate(
      'json',
      z.object({ currentPassword: z.string().max(PASSWORD_MAX_LENGTH), newPassword: password }),
    ),
    async (c) => {
      const { db, limiters } = c.var.deps
      const { currentPassword, newPassword } = c.req.valid('json')
      const user = c.var.user
      if (!limiters.reauth.hit(user.id)) return c.json({ error: 'too_many_attempts' as const }, 429)
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        return c.json({ error: 'invalid_password' as const }, 400)
      }
      db.update(users)
        .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .run()
      revokeUserSessions(db, user.id, c.var.sessionHash)
      audit(db, {
        actorId: user.id,
        action: 'user.password_changed',
        targetType: 'user',
        targetId: user.id,
        ip: c.var.ip,
      })
      return c.json({ ok: true as const })
    },
  )
  .post(
    '/totp/setup',
    requireUser,
    validate('json', z.object({ password: z.string().max(PASSWORD_MAX_LENGTH) })),
    async (c) => {
      const { db, box, limiters } = c.var.deps
      const user = c.var.user
      if (!limiters.reauth.hit(user.id)) return c.json({ error: 'too_many_attempts' as const }, 429)
      if (!(await verifyPassword(c.req.valid('json').password, user.passwordHash))) {
        return c.json({ error: 'invalid_password' as const }, 400)
      }
      const { secret, uri } = generateTotpSecret(user.email)
      db.update(users)
        .set({ totpPendingEnc: box.encrypt(secret) })
        .where(eq(users.id, user.id))
        .run()
      return c.json({ secret, uri })
    },
  )
  .post('/totp/enable', requireUser, validate('json', z.object({ code })), (c) => {
    const { db, box, config, limiters } = c.var.deps
    const user = c.var.user
    if (!user.totpPendingEnc) return c.json({ error: 'no_pending_totp' as const }, 400)
    if (!limiters.reauth.hit(user.id)) return c.json({ error: 'too_many_attempts' as const }, 429)
    const pending = user.totpPendingEnc
    const step = checkTotp(box.decrypt(pending), c.req.valid('json').code)
    if (step === null) return c.json({ error: 'invalid_code' as const }, 400)
    const updated = db
      .update(users)
      .set({
        totpSecretEnc: pending,
        totpPendingEnc: null,
        totpLastStep: step,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning()
      .get()
    revokeUserSessions(db, user.id, c.var.sessionHash)
    audit(db, {
      actorId: user.id,
      action: 'user.totp_enabled',
      targetType: 'user',
      targetId: user.id,
      ip: c.var.ip,
    })
    return c.json({ user: publicUser(updated, config.requireAdminTotp) })
  })
  .post(
    '/totp/disable',
    requireUser,
    validate('json', z.object({ password: z.string().max(PASSWORD_MAX_LENGTH), code })),
    async (c) => {
      const { db, box, config, limiters } = c.var.deps
      const user = c.var.user
      if (!user.totpSecretEnc) return c.json({ error: 'totp_not_enabled' as const }, 400)
      if (config.requireAdminTotp && user.role === 'superadmin') {
        return c.json({ error: 'totp_mandatory' as const }, 403)
      }
      if (!limiters.reauth.hit(user.id)) return c.json({ error: 'too_many_attempts' as const }, 429)
      const body = c.req.valid('json')
      const ok =
        (await verifyPassword(body.password, user.passwordHash)) &&
        verifyUserTotp(db, user, box.decrypt(user.totpSecretEnc), body.code)
      if (!ok) return c.json({ error: 'invalid_credentials' as const }, 400)
      const updated = db
        .update(users)
        .set({
          totpSecretEnc: null,
          totpPendingEnc: null,
          totpLastStep: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning()
        .get()
      audit(db, {
        actorId: user.id,
        action: 'user.totp_disabled',
        targetType: 'user',
        targetId: user.id,
        ip: c.var.ip,
      })
      return c.json({ user: publicUser(updated, config.requireAdminTotp) })
    },
  )

export const authRoutes = new Hono<AppEnv>()
  .get('/me', (c) => {
    const user = c.var.user
    return c.json({ user: user ? publicUser(user, c.var.deps.config.requireAdminTotp) : null })
  })
  .post('/login', validate('json', LoginBody), async (c) => {
    const { db, box, config, limiters } = c.var.deps
    const body = c.req.valid('json')
    const accountKey = body.email.trim().toLowerCase()

    if (!limiters.loginIp.hit(c.var.ip) || limiters.loginAccount.isBlocked(accountKey)) {
      return c.json({ error: 'too_many_attempts' as const }, 429)
    }

    const user = db.select().from(users).where(eq(users.email, accountKey)).get()
    const passwordOk = await verifyPassword(body.password, user?.passwordHash)
    if (!user || !passwordOk || user.disabledAt) {
      limiters.loginAccount.hit(accountKey)
      audit(db, { action: 'auth.login_failed', ip: c.var.ip, details: { email: accountKey } })
      return c.json({ error: 'invalid_credentials' as const }, 401)
    }

    if (user.totpSecretEnc) {
      if (!body.code) return c.json({ status: 'totp_required' as const })
      if (!verifyUserTotp(db, user, box.decrypt(user.totpSecretEnc), body.code)) {
        limiters.loginAccount.hit(accountKey)
        audit(db, { actorId: user.id, action: 'auth.totp_failed', ip: c.var.ip })
        return c.json({ error: 'invalid_code' as const }, 401)
      }
    }

    limiters.loginAccount.reset(accountKey)
    const token = createSession(db, user.id, {
      ip: c.var.ip,
      userAgent: c.req.header('user-agent'),
    })
    setSessionCookie(c, token)
    audit(db, { actorId: user.id, action: 'auth.login', ip: c.var.ip })
    return c.json({ status: 'ok' as const, user: publicUser(user, config.requireAdminTotp) })
  })
  .post('/logout', (c) => {
    if (c.var.sessionHash) revokeSession(c.var.deps.db, c.var.sessionHash)
    clearSessionCookie(c)
    return c.json({ ok: true as const })
  })
  .post('/token/inspect', validate('json', z.object({ token: z.string().max(200) })), (c) => {
    const { db, limiters } = c.var.deps
    if (!limiters.tokenIp.hit(c.var.ip)) return c.json({ error: 'too_many_attempts' as const }, 429)
    const found = findValidToken(db, c.req.valid('json').token)
    if (!found) return c.json({ error: 'invalid_token' as const }, 404)
    return c.json({
      type: found.type,
      email: found.user?.email ?? null,
      name: found.user?.name ?? null,
    })
  })
  .post('/token/accept', validate('json', AcceptBody), async (c) => {
    const { db, config, limiters } = c.var.deps
    if (!limiters.tokenIp.hit(c.var.ip)) return c.json({ error: 'too_many_attempts' as const }, 429)
    const body = c.req.valid('json')
    const found = findValidToken(db, body.token)
    if (!found) return c.json({ error: 'invalid_token' as const }, 404)

    if (found.type === 'setup') {
      if (!body.email || !body.name) return c.json({ error: 'invalid_input' as const }, 400)
      if (db.select({ id: users.id }).from(users).limit(1).get()) {
        return c.json({ error: 'invalid_token' as const }, 404)
      }
    }

    const passwordHash = await hashPassword(body.password)
    if (!consumeToken(db, found.id)) return c.json({ error: 'invalid_token' as const }, 404)

    let user = found.user
    if (found.type === 'setup') {
      user = db
        .insert(users)
        .values({
          email: body.email as string,
          name: body.name as string,
          role: 'superadmin',
          passwordHash,
        })
        .returning()
        .get()
    } else if (user) {
      user = db
        .update(users)
        .set({ passwordHash, ...(body.name ? { name: body.name } : {}), updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning()
        .get()
      revokeUserSessions(db, user.id)
    }
    if (!user) return c.json({ error: 'invalid_token' as const }, 404)
    audit(db, {
      actorId: user.id,
      action: `auth.token_accepted.${found.type}`,
      targetType: 'user',
      targetId: user.id,
      ip: c.var.ip,
    })

    // Never let a link bypass two-factor auth: those users sign in normally.
    if (user.totpSecretEnc) return c.json({ status: 'login_required' as const })
    const token = createSession(db, user.id, {
      ip: c.var.ip,
      userAgent: c.req.header('user-agent'),
    })
    setSessionCookie(c, token)
    return c.json({ status: 'ok' as const, user: publicUser(user, config.requireAdminTotp) })
  })
  .route('/', authed)
