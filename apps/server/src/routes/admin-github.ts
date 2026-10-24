import { eq, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { CONFIG_PATHS } from '../content/service'
import { sites } from '../db/schema'
import type { AuthedEnv } from '../env'
import { githubFailure } from '../github/link'
import { isLinked, SiteSync } from '../github/sync'
import { validate } from '../lib/http'

/** Superadmin-only GitHub endpoints; mounted inside the admin routes. */
export const adminGithubRoutes = new Hono<AuthedEnv>()
  .get('/github', async (c) => {
    const { github } = c.var.deps
    if (!github) {
      return c.json({
        configured: false as const,
        org: null,
        app: null,
        repoCount: null,
        error: null,
        message: null,
        webhook: { configured: false, lastReceivedAt: null },
      })
    }
    const webhook = {
      configured: !!github.webhookSecret,
      lastReceivedAt: github.lastWebhookAt?.getTime() ?? null,
    }
    try {
      const app = await github.getApp()
      const repos = await github.listRepositories()
      return c.json({
        configured: true as const,
        org: github.org,
        app,
        repoCount: repos.length,
        error: null,
        message: null,
        webhook,
      })
    } catch (err) {
      const failure = githubFailure(err)
      return c.json({
        configured: true as const,
        org: github.org,
        app: null,
        repoCount: null,
        error: failure.error,
        message: failure.message,
        webhook,
      })
    }
  })
  .get(
    '/github/repos',
    validate('query', z.object({ refresh: z.enum(['1']).optional() })),
    async (c) => {
      const { github, db } = c.var.deps
      if (!github) return c.json({ error: 'github_not_configured' as const }, 400)
      try {
        const repos = await github.listRepositories({ refresh: !!c.req.valid('query').refresh })
        const linked = new Map(
          db
            .select({ id: sites.id, repoId: sites.repoId })
            .from(sites)
            .where(isNotNull(sites.repoId))
            .all()
            .map((s) => [s.repoId, s.id]),
        )
        return c.json({ repos: repos.map((r) => ({ ...r, siteId: linked.get(r.id) ?? null })) })
      } catch (err) {
        const failure = githubFailure(err)
        return c.json({ error: failure.error }, failure.status)
      }
    },
  )
  .get('/sites/:id/check', validate('param', z.object({ id: z.string().max(64) })), async (c) => {
    const { github, db } = c.var.deps
    const site = db
      .select()
      .from(sites)
      .where(eq(sites.id, c.req.valid('param').id))
      .get()
    if (!site) return c.json({ error: 'not_found' as const }, 404)
    if (!github) return c.json({ error: 'github_not_configured' as const }, 400)
    if (!isLinked(site)) return c.json({ error: 'site_not_linked' as const }, 400)
    try {
      const sync = new SiteSync(db, github)
      const head = await sync.head(site, { fresh: true })
      const tree = await sync.tree(site, head.treeSha)
      const paths = new Set(tree.entries.filter((e) => e.type === 'blob').map((e) => e.path))
      return c.json({
        repoFullName: site.repoFullName,
        branch: site.branch,
        commitSha: head.commitSha,
        fileCount: paths.size,
        truncated: tree.truncated,
        configPath: CONFIG_PATHS.find((p) => paths.has(p)) ?? null,
      })
    } catch (err) {
      const failure = githubFailure(err)
      return c.json({ error: failure.error, message: failure.message }, failure.status)
    }
  })
