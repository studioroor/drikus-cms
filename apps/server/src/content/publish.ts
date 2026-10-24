import { and, desc, eq } from 'drizzle-orm'
import {
  type Draft,
  drafts,
  gitBlobs,
  type Publish,
  type PublishedChange,
  publishes,
  type StagedMedia,
  sites,
  stagedMedia,
  type User,
} from '../db/schema'
import { GitHubError, type TreeChange } from '../github/app'
import { gitBlobSha } from '../github/sha'
import { type Collection, type Config, siteLocales } from './config'
import { checkFields } from './fields'
import { isSafeRepoPath, MEDIA_COLLECTION, MediaService } from './media'
import { entryPathFor } from './paths'
import { ContentError, type ContentService, type PublishProblem } from './service'

/** How often to rebuild the commit when someone else pushed in the meantime. */
const MAX_ATTEMPTS = 3
/** Checks can take a moment to appear after a push; until then the deploy counts as pending. */
const CHECKS_GRACE_MS = 3 * 60 * 1000

/** One publish per site at a time (the CMS runs as a single process). */
const running = new Set<string>()

function draftTitle(draft: Draft) {
  const title = draft.data?.title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

function changeStatus(draft: Draft): PublishedChange['status'] {
  return draft.action === 'delete' ? 'deleted' : draft.baseSha ? 'modified' : 'new'
}

export function summarize(draftList: Draft[], media: StagedMedia[] = []): PublishedChange[] {
  return [
    ...draftList.map((d) => ({
      collection: d.collection,
      slug: d.slug,
      locale: d.locale,
      path: d.path,
      status: changeStatus(d),
      title: draftTitle(d),
    })),
    ...media.map((m) => {
      const name = m.path.split('/').pop() as string
      return {
        collection: MEDIA_COLLECTION,
        slug: name,
        path: m.path,
        status: 'new' as const,
        title: name,
      }
    }),
  ]
}

/**
 * Checks drafts against the current branch: the config must still allow the
 * path, required fields must be filled, and the file must not have changed on
 * GitHub since the draft started (otherwise we'd overwrite someone's work).
 */
export function findProblems(
  draftList: Draft[],
  files: Map<string, string>,
  config: Config,
): PublishProblem[] {
  const problems: PublishProblem[] = []
  const paths = new Set(files.keys())
  const site = siteLocales(config)
  for (const draft of draftList) {
    const base = {
      collection: draft.collection,
      slug: draft.slug,
      title: draftTitle(draft),
      locale: draft.locale,
    }
    const collection: Collection | undefined = config.collections.find(
      (c) => c.name === draft.collection,
    )
    // Data files with all languages have no language of their own; any language gives their path.
    const locale = collection?.translation ? (draft.locale ?? site?.main ?? null) : null
    if (
      !collection ||
      (collection.translation && draft.locale && !site?.locales.includes(draft.locale)) ||
      entryPathFor(collection, draft.slug, paths, locale) !== draft.path
    ) {
      problems.push({ kind: 'config', ...base })
      continue
    }
    const current = files.get(draft.path) ?? null
    const alreadyThere =
      draft.action === 'upsert' ? current === gitBlobSha(draft.content ?? '') : current === null
    if (current !== draft.baseSha && !alreadyThere) {
      problems.push({ kind: 'conflict', ...base })
      continue
    }
    if (draft.action === 'upsert') {
      // Check each language section of a data file with all languages; else the file itself.
      const sections =
        collection.translation === 'sections'
          ? (site?.locales ?? [])
              .filter((l) => draft.data?.[l] && typeof draft.data[l] === 'object')
              .map((l) => ({ locale: l, data: draft.data?.[l] as Record<string, unknown> }))
          : [{ locale: draft.locale, data: draft.data ?? {} }]
      for (const section of sections) {
        const missing = checkFields(collection.fields, section.data)
          .filter((i) => i.code === 'required')
          .map((i) => i.path)
        if (missing.length) {
          problems.push({ ...base, kind: 'required', locale: section.locale, fields: missing })
        }
      }
    }
  }
  return problems
}

/** Turns drafts and uploads into tree changes, skipping ones that already match GitHub. */
export function treeChanges(
  draftList: Draft[],
  files: Map<string, string>,
  media: StagedMedia[] = [],
): TreeChange[] {
  const changes: TreeChange[] = []
  for (const m of media) {
    if (isSafeRepoPath(m.path) && files.get(m.path) !== gitBlobSha(m.bytes)) {
      changes.push({ path: m.path, content: m.bytes })
    }
  }
  for (const d of draftList) {
    const current = files.get(d.path) ?? null
    if (d.action === 'delete') {
      if (current !== null) changes.push({ path: d.path, content: null })
    } else if (current !== gitBlobSha(d.content ?? '')) {
      changes.push({ path: d.path, content: d.content ?? '' })
    }
  }
  return changes
}

export function commitMessage(message: string | undefined, changes: PublishedChange[], user: User) {
  const subject =
    message?.trim().split('\n')[0]?.slice(0, 120) ||
    `Update ${changes.length} ${changes.length === 1 ? 'item' : 'items'} via Drikus CMS`
  const lines = changes.map((c) => `- ${c.status} ${c.path}`)
  return `${subject}\n\n${lines.join('\n')}\n\nDrikus-CMS-User: ${user.name} <${user.id}>\n`
}

export class PublishService {
  constructor(readonly content: ContentService) {}

  get #db() {
    return this.content.db
  }
  get #site() {
    return this.content.site
  }

  async preview() {
    await this.content.refresh()
    const [files, config] = await Promise.all([this.content.files(), this.content.config()])
    const pending = this.content.drafts()
    const media = new MediaService(this.content).staged()
    return { changes: summarize(pending, media), problems: findProblems(pending, files, config) }
  }

  /** Resolves a conflict: keep the draft (overwriting GitHub) or drop it (keeping GitHub's version). */
  async resolve(collection: string, slug: string, keep: 'mine' | 'theirs', locale?: string | null) {
    const draft = this.content
      .drafts(collection)
      .find((d) => d.slug === slug && (!locale || d.locale === locale))
    if (!draft) throw new ContentError('not_found', 404)
    const where = and(eq(drafts.siteId, this.#site.id), eq(drafts.path, draft.path))
    // Always re-read the branch, so the editor sees the version GitHub has now.
    await this.content.refresh()
    if (keep === 'theirs') {
      this.#db.delete(drafts).where(where).run()
    } else {
      const current = (await this.content.files()).get(draft.path) ?? null
      this.#db.update(drafts).set({ baseSha: current }).where(where).run()
    }
    return { ok: true as const }
  }

  async publish(user: User, message?: string): Promise<{ publish: Publish | null }> {
    const siteId = this.#site.id
    if (running.has(siteId)) throw new ContentError('publish_in_progress', 409)
    running.add(siteId)
    try {
      return await this.#publish(user, message)
    } finally {
      running.delete(siteId)
    }
  }

  async #publish(user: User, message?: string) {
    const site = this.#site
    const repo = this.content.sync.github.repo(site.repoId)

    for (let attempt = 1; ; attempt++) {
      await this.content.refresh()
      const head = await this.content.sync.head(site)
      const [files, config] = await Promise.all([this.content.files(), this.content.config()])
      const snapshot = this.content.drafts()
      const media = new MediaService(this.content).staged()
      if (snapshot.length === 0 && media.length === 0) {
        throw new ContentError('nothing_to_publish', 400)
      }
      const problems = findProblems(snapshot, files, config)
      if (problems.length) throw new ContentError('publish_blocked', 409, problems)

      const changes = treeChanges(snapshot, files, media)
      if (changes.length === 0) {
        // Everything is already on GitHub (e.g. someone pushed the same edit).
        this.#settle(snapshot, new Map(), media)
        return { publish: null }
      }

      const summary = summarize(snapshot, media).filter((c) =>
        changes.some((t) => t.path === c.path),
      )
      const tree = await repo.createTree(site.repoFullName, head.treeSha, changes)
      const commitSha = await repo.createCommit(site.repoFullName, {
        message: commitMessage(message, summary, user),
        tree,
        parent: head.commitSha,
        author: { name: user.name, email: `${user.id}@users.noreply.drikus-cms.invalid` },
      })
      try {
        await repo.updateBranch(site.repoFullName, site.branch, commitSha)
      } catch (err) {
        // 422: the branch moved since we read it. Rebuild on top of the new head.
        if (err instanceof GitHubError && err.status === 422 && attempt < MAX_ATTEMPTS) continue
        throw err
      }

      const published = new Map(
        changes.map((c) => [c.path, c.content === null ? null : gitBlobSha(c.content)]),
      )
      const record = this.#db.transaction((tx) => {
        tx.update(sites)
          .set({ headSha: commitSha, headTreeSha: tree, headCheckedAt: new Date() })
          .where(eq(sites.id, site.id))
          .run()
        for (const c of changes) {
          if (c.content === null) continue
          const content = typeof c.content === 'string' ? Buffer.from(c.content, 'utf8') : c.content
          tx.insert(gitBlobs)
            .values({ sha: gitBlobSha(content), content, size: content.length })
            .onConflictDoNothing()
            .run()
        }
        return tx
          .insert(publishes)
          .values({
            siteId: site.id,
            userId: user.id,
            commitSha,
            message: commitMessage(message, summary, user),
            changes: summary,
          })
          .returning()
          .get()
      })
      this.#settle(snapshot, published, media)
      return { publish: record }
    }
  }

  /**
   * Removes published drafts. A draft edited while we were publishing stays,
   * re-based on what we just published so it isn't seen as a conflict.
   */
  #settle(snapshot: Draft[], published: Map<string, string | null>, media: StagedMedia[]) {
    this.#db.transaction((tx) => {
      // Uploads are immutable (content-hashed names), so published ones can simply go.
      for (const m of media) {
        tx.delete(stagedMedia)
          .where(and(eq(stagedMedia.siteId, m.siteId), eq(stagedMedia.path, m.path)))
          .run()
      }
      for (const draft of snapshot) {
        const where = and(eq(drafts.siteId, draft.siteId), eq(drafts.path, draft.path))
        const current = tx.select().from(drafts).where(where).get()
        if (!current) continue
        if (current.updatedAt.getTime() === draft.updatedAt.getTime()) {
          tx.delete(drafts).where(where).run()
        } else if (published.has(draft.path)) {
          tx.update(drafts)
            .set({ baseSha: published.get(draft.path) ?? null })
            .where(where)
            .run()
        }
      }
    })
  }

  history(limit = 10) {
    return this.#db
      .select()
      .from(publishes)
      .where(eq(publishes.siteId, this.#site.id))
      .orderBy(desc(publishes.createdAt))
      .limit(limit)
      .all()
  }

  /** The deploy state of a publish, from the commit's check runs and statuses. */
  async deployStatus(publishId: string) {
    const record = this.#db
      .select()
      .from(publishes)
      .where(and(eq(publishes.id, publishId), eq(publishes.siteId, this.#site.id)))
      .get()
    if (!record) throw new ContentError('not_found', 404)

    let state = record.deployState
    let checks: { name: string; state: 'pending' | 'success' | 'failure'; url: string | null }[] =
      []
    try {
      checks = await this.content.sync.github
        .repo(this.#site.repoId)
        .commitChecks(this.#site.repoFullName, record.commitSha)
      const age = Date.now() - record.createdAt.getTime()
      state =
        checks.length === 0
          ? age < CHECKS_GRACE_MS
            ? 'pending'
            : 'none'
          : checks.some((c) => c.state === 'failure')
            ? 'failure'
            : checks.some((c) => c.state === 'pending')
              ? 'pending'
              : 'success'
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err
      state = 'unknown'
    }
    if (state !== record.deployState) {
      this.#db
        .update(publishes)
        .set({ deployState: state, deployCheckedAt: new Date() })
        .where(eq(publishes.id, record.id))
        .run()
    }
    return { id: record.id, state, checks }
  }
}
