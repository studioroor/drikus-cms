import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { Collection } from '../content/config'
import { PublishService } from '../content/publish'
import { ContentError, ContentService } from '../content/service'
import { sites, users } from '../db/schema'
import type { AuthedEnv } from '../env'
import { GitHubError } from '../github/app'
import { githubFailure } from '../github/link'
import { isLinked, SiteSync } from '../github/sync'
import { audit } from '../lib/audit'
import { validate } from '../lib/http'

interface ContentEnv extends AuthedEnv {
  Variables: AuthedEnv['Variables'] & { content: ContentService | null; siteState: SiteState }
}

type SiteState = 'ok' | 'not_linked' | 'github_not_configured'

const Data = z.object({ data: z.record(z.string(), z.unknown()) })
const CollectionParam = z.object({ collection: z.string().max(64) })
const EntryParam = z.object({ collection: z.string().max(64), slug: z.string().max(130) })
const limit = bodyLimit({ maxSize: 2 * 1024 * 1024 })
const PublishBody = z.object({ message: z.string().trim().max(500).optional() })
const CommitSha = z.string().regex(/^[0-9a-f]{40}$/)
const RevisionParam = EntryParam.extend({ rev: z.union([z.literal('draft'), CommitSha]) })
const RestoreParam = EntryParam.extend({ rev: CommitSha })
const ResolveBody = z.object({ keep: z.enum(['mine', 'theirs']) })

/** Builds the content service for the site in the URL (access was already checked). */
const loadContent = createMiddleware<ContentEnv>(async (c, next) => {
  const { db, github } = c.var.deps
  const site = db
    .select()
    .from(sites)
    .where(eq(sites.id, c.req.param('siteId') ?? ''))
    .get()
  if (!site) return c.json({ error: 'not_found' as const }, 404)
  if (!github) {
    c.set('siteState', 'github_not_configured')
    c.set('content', null)
  } else if (!isLinked(site)) {
    c.set('siteState', 'not_linked')
    c.set('content', null)
  } else {
    c.set('siteState', 'ok')
    c.set('content', new ContentService(db, new SiteSync(db, github), site))
  }
  await next()
})

function requireContent(c: Context<ContentEnv>): ContentService {
  const content = c.var.content
  if (!content) throw new ContentError('not_found', 409)
  return content
}

/** Turns content and GitHub failures into JSON errors the UI can translate. */
async function handle<T>(c: Context<ContentEnv>, fn: () => Promise<T>) {
  try {
    return c.json((await fn()) as T & object)
  } catch (err) {
    if (err instanceof ContentError) {
      if (!c.var.content) return c.json({ error: c.var.siteState }, 409)
      return c.json({ error: err.code, issues: err.issues ?? null }, err.status)
    }
    if (err instanceof GitHubError) {
      const failure = githubFailure(err)
      return c.json({ error: failure.error, issues: null }, failure.status)
    }
    throw err
  }
}

function clientCollection(c: Collection) {
  return {
    name: c.name,
    label: c.label ?? null,
    description: c.description ?? null,
    kind: c.folder ? ('folder' as const) : ('file' as const),
    format: c.format,
    summary: c.summary ?? null,
    create: c.create,
    delete: c.delete,
    fields: c.fields,
  }
}

export type ClientCollection = ReturnType<typeof clientCollection>

export const contentRoutes = new Hono<ContentEnv>()
  .use(loadContent)
  .get('/content', (c) =>
    handle(c, async () => {
      const content = c.var.content
      if (!content) {
        return { status: c.var.siteState, collections: [], issues: null, changes: 0 }
      }
      const state = await content.configState()
      if (state.status !== 'ok') {
        // Only the superadmin needs the technical details of a broken config.
        const issues =
          state.status === 'invalid_config' && c.var.user.role === 'superadmin'
            ? state.issues
            : null
        return { status: state.status, collections: [], issues, changes: 0 }
      }
      return {
        status: 'ok' as const,
        collections: state.config.collections.map(clientCollection),
        issues: null,
        changes: content.drafts().length,
      }
    }),
  )
  .get('/changes', (c) => handle(c, async () => ({ changes: requireContent(c).changes() })))
  .get('/collections/:collection/entries', validate('param', CollectionParam), (c) =>
    handle(c, async () => ({
      entries: await requireContent(c).listEntries(c.req.valid('param').collection),
    })),
  )
  .post(
    '/collections/:collection/entries',
    limit,
    validate('param', CollectionParam),
    validate('json', Data),
    (c) =>
      handle(c, async () => {
        const { collection } = c.req.valid('param')
        const res = await requireContent(c).createEntry(
          collection,
          c.req.valid('json').data,
          c.var.user.id,
        )
        audit(c.var.deps.db, {
          actorId: c.var.user.id,
          action: 'content.created',
          targetType: 'site',
          targetId: c.req.param('siteId'),
          ip: c.var.ip,
          details: { collection, slug: res.slug },
        })
        return res
      }),
  )
  .get('/collections/:collection/entries/:slug', validate('param', EntryParam), (c) =>
    handle(c, async () => {
      const { collection, slug } = c.req.valid('param')
      return requireContent(c).readEntry(collection, slug)
    }),
  )
  .put(
    '/collections/:collection/entries/:slug',
    limit,
    validate('param', EntryParam),
    validate('json', Data),
    (c) =>
      handle(c, async () => {
        const { collection, slug } = c.req.valid('param')
        return requireContent(c).saveDraft(
          collection,
          slug,
          c.req.valid('json').data,
          c.var.user.id,
        )
      }),
  )
  .delete('/collections/:collection/entries/:slug', validate('param', EntryParam), (c) =>
    handle(c, async () => {
      const { collection, slug } = c.req.valid('param')
      const res = await requireContent(c).deleteEntry(collection, slug, c.var.user.id)
      audit(c.var.deps.db, {
        actorId: c.var.user.id,
        action: 'content.deleted',
        targetType: 'site',
        targetId: c.req.param('siteId'),
        ip: c.var.ip,
        details: { collection, slug },
      })
      return res
    }),
  )
  .post('/collections/:collection/entries/:slug/discard', validate('param', EntryParam), (c) =>
    handle(c, async () => {
      const { collection, slug } = c.req.valid('param')
      return requireContent(c).discard(collection, slug)
    }),
  )
  // --- Revisions ---------------------------------------------------------------
  .get('/collections/:collection/entries/:slug/revisions', validate('param', EntryParam), (c) =>
    handle(c, async () => {
      const { collection, slug } = c.req.valid('param')
      return requireContent(c).revisions(collection, slug)
    }),
  )
  .get(
    '/collections/:collection/entries/:slug/revisions/:rev',
    validate('param', RevisionParam),
    (c) =>
      handle(c, async () => {
        const { collection, slug, rev } = c.req.valid('param')
        return requireContent(c).readRevision(collection, slug, rev)
      }),
  )
  .post(
    '/collections/:collection/entries/:slug/revisions/:rev/restore',
    validate('param', RestoreParam),
    (c) =>
      handle(c, async () => {
        const { collection, slug, rev } = c.req.valid('param')
        const res = await requireContent(c).restoreRevision(collection, slug, rev, c.var.user.id)
        audit(c.var.deps.db, {
          actorId: c.var.user.id,
          action: 'content.restored',
          targetType: 'site',
          targetId: c.req.param('siteId'),
          ip: c.var.ip,
          details: { collection, slug, commitSha: rev },
        })
        return res
      }),
  )
  .post(
    '/collections/:collection/entries/:slug/resolve',
    validate('param', EntryParam),
    validate('json', ResolveBody),
    (c) =>
      handle(c, async () => {
        const { collection, slug } = c.req.valid('param')
        return new PublishService(requireContent(c)).resolve(
          collection,
          slug,
          c.req.valid('json').keep,
        )
      }),
  )
  // --- Publishing ------------------------------------------------------------
  .get('/publish', (c) => handle(c, () => new PublishService(requireContent(c)).preview()))
  .post('/publish', validate('json', PublishBody), (c) =>
    handle(c, async () => {
      const res = await new PublishService(requireContent(c)).publish(
        c.var.user,
        c.req.valid('json').message,
      )
      if (res.publish) {
        audit(c.var.deps.db, {
          actorId: c.var.user.id,
          action: 'content.published',
          targetType: 'site',
          targetId: c.req.param('siteId'),
          ip: c.var.ip,
          details: { commitSha: res.publish.commitSha, changes: res.publish.changes.length },
        })
      }
      return {
        publish: res.publish
          ? { id: res.publish.id, commitSha: res.publish.commitSha, changes: res.publish.changes }
          : null,
      }
    }),
  )
  .get('/publishes', (c) =>
    handle(c, async () => {
      const { db } = c.var.deps
      const names = new Map(
        db
          .select({ id: users.id, name: users.name })
          .from(users)
          .all()
          .map((u) => [u.id, u.name]),
      )
      const showCommits = c.var.user.role === 'superadmin'
      const repo = c.var.content?.site.repoFullName
      return {
        publishes: new PublishService(requireContent(c)).history().map((p) => ({
          id: p.id,
          createdAt: p.createdAt.getTime(),
          userName: p.userId ? (names.get(p.userId) ?? null) : null,
          changes: p.changes,
          deployState: p.deployState,
          // Commit links are for the superadmin; clients don't use GitHub.
          commitUrl:
            showCommits && repo ? `https://github.com/${repo}/commit/${p.commitSha}` : null,
        })),
      }
    }),
  )
  .get(
    '/publishes/:publishId/status',
    validate('param', z.object({ publishId: z.string().max(64) })),
    (c) =>
      handle(c, () =>
        new PublishService(requireContent(c)).deployStatus(c.req.valid('param').publishId),
      ),
  )
