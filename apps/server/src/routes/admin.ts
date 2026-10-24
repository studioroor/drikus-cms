import { desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { revokeUserSessions } from '../auth/sessions'
import { createAuthToken, inviteLink } from '../auth/tokens'
import { auditLog, LOCALES, ROLES, siteMembers, sites, users } from '../db/schema'
import type { AuthedEnv } from '../env'
import { audit } from '../lib/audit'
import { validate } from '../lib/http'
import { requireSuperadmin } from '../middleware/auth'

const name = z.string().trim().min(1).max(100)
const ids = z.array(z.string().max(64)).max(1000)
const IdParam = z.object({ id: z.string().max(64) })

const UserCreate = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  name,
  role: z.enum(ROLES).default('editor'),
  locale: z.enum(LOCALES).default('nl'),
  siteIds: ids.default([]),
})

const UserUpdate = z.object({
  name: name.optional(),
  role: z.enum(ROLES).optional(),
  locale: z.enum(LOCALES).optional(),
  disabled: z.boolean().optional(),
})

const repoFullName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'owner/repo')
const SiteBody = z.object({
  name,
  siteUrl: z.url().max(500).nullable().optional(),
  repoFullName: repoFullName.nullable().optional(),
  branch: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/-]+$/)
    .max(200)
    .optional(),
})

function userStatus(u: { passwordHash: string | null; disabledAt: Date | null }) {
  if (u.disabledAt) return 'disabled' as const
  return u.passwordHash ? ('active' as const) : ('invited' as const)
}

function membershipsByUser(db: AuthedEnv['Variables']['deps']['db']) {
  const map = new Map<string, string[]>()
  for (const m of db.select().from(siteMembers).all()) {
    map.set(m.userId, [...(map.get(m.userId) ?? []), m.siteId])
  }
  return map
}

/** Keeps only IDs of sites that actually exist. */
function existingSiteIds(db: AuthedEnv['Variables']['deps']['db'], siteIds: string[]) {
  if (siteIds.length === 0) return []
  return db
    .select({ id: sites.id })
    .from(sites)
    .where(inArray(sites.id, siteIds))
    .all()
    .map((s) => s.id)
}

export const adminRoutes = new Hono<AuthedEnv>()
  .use(requireSuperadmin)
  // --- Users -----------------------------------------------------------------
  .get('/users', (c) => {
    const { db } = c.var.deps
    const memberships = membershipsByUser(db)
    const list = db
      .select()
      .from(users)
      .orderBy(users.name)
      .all()
      .map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        locale: u.locale,
        status: userStatus(u),
        totpEnabled: !!u.totpSecretEnc,
        siteIds: memberships.get(u.id) ?? [],
        createdAt: u.createdAt.getTime(),
      }))
    return c.json({ users: list })
  })
  .post('/users', validate('json', UserCreate), (c) => {
    const { db, config } = c.var.deps
    const body = c.req.valid('json')
    if (db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get()) {
      return c.json({ error: 'email_taken' as const }, 409)
    }
    const siteIds = existingSiteIds(db, body.siteIds)
    const user = db.transaction((tx) => {
      const created = tx
        .insert(users)
        .values({ email: body.email, name: body.name, role: body.role, locale: body.locale })
        .returning()
        .get()
      if (siteIds.length) {
        tx.insert(siteMembers)
          .values(siteIds.map((siteId) => ({ siteId, userId: created.id })))
          .run()
      }
      return created
    })
    const token = createAuthToken(db, { type: 'invite', userId: user.id, createdBy: c.var.user.id })
    audit(db, {
      actorId: c.var.user.id,
      action: 'user.created',
      targetType: 'user',
      targetId: user.id,
      ip: c.var.ip,
      details: { role: user.role, siteIds },
    })
    return c.json({ id: user.id, link: inviteLink(config.publicUrl, 'invite', token) }, 201)
  })
  .patch('/users/:id', validate('param', IdParam), validate('json', UserUpdate), (c) => {
    const { db } = c.var.deps
    const { id } = c.req.valid('param')
    const { disabled, ...rest } = c.req.valid('json')
    const target = db.select().from(users).where(eq(users.id, id)).get()
    if (!target) return c.json({ error: 'not_found' as const }, 404)
    // Guard against locking yourself out of the CMS.
    if (id === c.var.user.id && (disabled || (rest.role && rest.role !== 'superadmin'))) {
      return c.json({ error: 'cannot_modify_self' as const }, 400)
    }
    db.update(users)
      .set({
        ...rest,
        ...(disabled === undefined ? {} : { disabledAt: disabled ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .run()
    if (disabled || (rest.role && rest.role !== target.role)) revokeUserSessions(db, id)
    audit(db, {
      actorId: c.var.user.id,
      action: 'user.updated',
      targetType: 'user',
      targetId: id,
      ip: c.var.ip,
      details: c.req.valid('json'),
    })
    return c.json({ ok: true as const })
  })
  .delete('/users/:id', validate('param', IdParam), (c) => {
    const { db } = c.var.deps
    const { id } = c.req.valid('param')
    if (id === c.var.user.id) return c.json({ error: 'cannot_modify_self' as const }, 400)
    const deleted = db.delete(users).where(eq(users.id, id)).returning({ id: users.id }).all()
    if (deleted.length === 0) return c.json({ error: 'not_found' as const }, 404)
    audit(db, {
      actorId: c.var.user.id,
      action: 'user.deleted',
      targetType: 'user',
      targetId: id,
      ip: c.var.ip,
    })
    return c.json({ ok: true as const })
  })
  .post('/users/:id/link', validate('param', IdParam), (c) => {
    const { db, config } = c.var.deps
    const { id } = c.req.valid('param')
    const target = db.select().from(users).where(eq(users.id, id)).get()
    if (!target) return c.json({ error: 'not_found' as const }, 404)
    if (target.disabledAt) return c.json({ error: 'user_disabled' as const }, 400)
    const type = target.passwordHash ? ('reset' as const) : ('invite' as const)
    const token = createAuthToken(db, { type, userId: id, createdBy: c.var.user.id })
    audit(db, {
      actorId: c.var.user.id,
      action: `user.link_created.${type}`,
      targetType: 'user',
      targetId: id,
      ip: c.var.ip,
    })
    return c.json({ type, link: inviteLink(config.publicUrl, type, token) })
  })
  .post('/users/:id/reset-totp', validate('param', IdParam), (c) => {
    const { db } = c.var.deps
    const { id } = c.req.valid('param')
    if (id === c.var.user.id) return c.json({ error: 'cannot_modify_self' as const }, 400)
    const res = db
      .update(users)
      .set({ totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id })
      .all()
    if (res.length === 0) return c.json({ error: 'not_found' as const }, 404)
    revokeUserSessions(db, id)
    audit(db, {
      actorId: c.var.user.id,
      action: 'user.totp_reset',
      targetType: 'user',
      targetId: id,
      ip: c.var.ip,
    })
    return c.json({ ok: true as const })
  })
  .put(
    '/users/:id/sites',
    validate('param', IdParam),
    validate('json', z.object({ siteIds: ids })),
    (c) => {
      const { db } = c.var.deps
      const { id } = c.req.valid('param')
      if (!db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()) {
        return c.json({ error: 'not_found' as const }, 404)
      }
      const siteIds = existingSiteIds(db, c.req.valid('json').siteIds)
      db.transaction((tx) => {
        tx.delete(siteMembers).where(eq(siteMembers.userId, id)).run()
        if (siteIds.length) {
          tx.insert(siteMembers)
            .values(siteIds.map((siteId) => ({ siteId, userId: id })))
            .run()
        }
      })
      audit(db, {
        actorId: c.var.user.id,
        action: 'user.sites_updated',
        targetType: 'user',
        targetId: id,
        ip: c.var.ip,
        details: { siteIds },
      })
      return c.json({ ok: true as const })
    },
  )
  // --- Sites -----------------------------------------------------------------
  .get('/sites', (c) => {
    const { db } = c.var.deps
    const members = new Map<string, string[]>()
    for (const m of db.select().from(siteMembers).all()) {
      members.set(m.siteId, [...(members.get(m.siteId) ?? []), m.userId])
    }
    const list = db
      .select()
      .from(sites)
      .orderBy(sites.name)
      .all()
      .map((s) => ({
        id: s.id,
        name: s.name,
        siteUrl: s.siteUrl,
        repoFullName: s.repoFullName,
        branch: s.branch,
        memberIds: members.get(s.id) ?? [],
        createdAt: s.createdAt.getTime(),
      }))
    return c.json({ sites: list })
  })
  .post('/sites', validate('json', SiteBody), (c) => {
    const { db } = c.var.deps
    const body = c.req.valid('json')
    const site = db
      .insert(sites)
      .values({
        name: body.name,
        siteUrl: body.siteUrl ?? null,
        repoFullName: body.repoFullName ?? null,
        ...(body.branch ? { branch: body.branch } : {}),
      })
      .returning()
      .get()
    audit(db, {
      actorId: c.var.user.id,
      action: 'site.created',
      targetType: 'site',
      targetId: site.id,
      ip: c.var.ip,
    })
    return c.json({ id: site.id }, 201)
  })
  .patch('/sites/:id', validate('param', IdParam), validate('json', SiteBody.partial()), (c) => {
    const { db } = c.var.deps
    const { id } = c.req.valid('param')
    const res = db
      .update(sites)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(eq(sites.id, id))
      .returning({ id: sites.id })
      .all()
    if (res.length === 0) return c.json({ error: 'not_found' as const }, 404)
    audit(db, {
      actorId: c.var.user.id,
      action: 'site.updated',
      targetType: 'site',
      targetId: id,
      ip: c.var.ip,
      details: c.req.valid('json'),
    })
    return c.json({ ok: true as const })
  })
  .delete('/sites/:id', validate('param', IdParam), (c) => {
    const { db } = c.var.deps
    const { id } = c.req.valid('param')
    const deleted = db.delete(sites).where(eq(sites.id, id)).returning({ id: sites.id }).all()
    if (deleted.length === 0) return c.json({ error: 'not_found' as const }, 404)
    audit(db, {
      actorId: c.var.user.id,
      action: 'site.deleted',
      targetType: 'site',
      targetId: id,
      ip: c.var.ip,
    })
    return c.json({ ok: true as const })
  })
  .put(
    '/sites/:id/members',
    validate('param', IdParam),
    validate('json', z.object({ userIds: ids })),
    (c) => {
      const { db } = c.var.deps
      const { id } = c.req.valid('param')
      if (!db.select({ id: sites.id }).from(sites).where(eq(sites.id, id)).get()) {
        return c.json({ error: 'not_found' as const }, 404)
      }
      const requested = c.req.valid('json').userIds
      const userIds = requested.length
        ? db
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, requested))
            .all()
            .map((u) => u.id)
        : []
      db.transaction((tx) => {
        tx.delete(siteMembers).where(eq(siteMembers.siteId, id)).run()
        if (userIds.length) {
          tx.insert(siteMembers)
            .values(userIds.map((userId) => ({ siteId: id, userId })))
            .run()
        }
      })
      audit(db, {
        actorId: c.var.user.id,
        action: 'site.members_updated',
        targetType: 'site',
        targetId: id,
        ip: c.var.ip,
        details: { userIds },
      })
      return c.json({ ok: true as const })
    },
  )
  // --- Audit log -------------------------------------------------------------
  .get(
    '/audit',
    validate('query', z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })),
    (c) => {
      const { db } = c.var.deps
      const rows = db
        .select({ entry: auditLog, actor: { name: users.name, email: users.email } })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .orderBy(desc(auditLog.id))
        .limit(c.req.valid('query').limit)
        .all()
      return c.json({
        entries: rows.map(({ entry, actor }) => ({
          id: entry.id,
          at: entry.at.getTime(),
          action: entry.action,
          actor: actor?.email ? actor : null,
          targetType: entry.targetType,
          targetId: entry.targetId,
          ip: entry.ip,
          details: entry.details,
        })),
      })
    },
  )
