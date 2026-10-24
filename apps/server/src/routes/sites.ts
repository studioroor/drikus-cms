import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { siteMembers, sites } from '../db/schema'
import type { AuthedEnv } from '../env'
import { requireSiteAccess, requireUser } from '../middleware/auth'

function toPublicSite(s: typeof sites.$inferSelect) {
  return { id: s.id, name: s.name, siteUrl: s.siteUrl }
}

export const siteRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', (c) => {
    const { db } = c.var.deps
    const user = c.var.user
    const list =
      user.role === 'superadmin'
        ? db.select().from(sites).orderBy(sites.name).all()
        : db
            .select({ site: sites })
            .from(siteMembers)
            .innerJoin(sites, eq(sites.id, siteMembers.siteId))
            .where(eq(siteMembers.userId, user.id))
            .orderBy(sites.name)
            .all()
            .map((r) => r.site)
    return c.json({ sites: list.map(toPublicSite) })
  })
  .use('/:siteId/*', requireSiteAccess)
  .use('/:siteId', requireSiteAccess)
  .get('/:siteId', (c) => {
    const site = c.var.deps.db
      .select()
      .from(sites)
      .where(eq(sites.id, c.req.param('siteId')))
      .get()
    if (!site) return c.json({ error: 'not_found' as const }, 404)
    return c.json({ site: toPublicSite(site) })
  })
