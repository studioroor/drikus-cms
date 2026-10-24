import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { gitBlobs, gitTrees, type Site, sites, type TreeEntry } from '../db/schema'
import { type BranchHead, type FileCommit, type GitHubApp, GitHubError } from './app'

/** Without webhooks, re-check the branch head at most this often. */
const HEAD_TTL_POLLING_MS = 15 * 1000
/** With working webhooks, pushes update the head for us; re-check only occasionally. */
const HEAD_TTL_WEBHOOKS_MS = 5 * 60 * 1000
const WEBHOOK_HEALTHY_MS = 24 * 60 * 60 * 1000
/** How many revisions of a file we show. */
export const HISTORY_LIMIT = 50
const MEMO_SIZE = 1000

/** A small in-memory memo that forgets its oldest entries. */
function memo<V>() {
  const map = new Map<string, V>()
  return {
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    set(key: string, value: V) {
      map.set(key, value)
      if (map.size > MEMO_SIZE) map.delete(map.keys().next().value as string)
    },
  }
}

/** File history by repo, head and path: a new head means new history. */
const histories = memo<FileCommit[]>()
/** Blob SHA (or null: no file) by repo, commit and path. Commits never change. */
const filesAtCommit = memo<string | null>()

export interface LinkedSite extends Site {
  repoId: number
  repoFullName: string
}

export function isLinked(site: Site): site is LinkedSite {
  return site.repoId !== null && site.repoFullName !== null
}

/**
 * Reads repository content for a site with as few GitHub calls as possible:
 * the branch head is cached briefly (or kept fresh by push webhooks), and
 * trees and blobs are cached forever by SHA.
 */
export class SiteSync {
  constructor(
    readonly db: Db,
    readonly github: GitHubApp,
  ) {}

  #headTtl() {
    const last = this.github.lastWebhookAt?.getTime()
    return last && Date.now() - last < WEBHOOK_HEALTHY_MS
      ? HEAD_TTL_WEBHOOKS_MS
      : HEAD_TTL_POLLING_MS
  }

  /** Runs a repo call, re-resolving the repo name once if it was renamed. */
  async #withRepo<T>(site: LinkedSite, fn: (fullName: string) => Promise<T>): Promise<T> {
    const client = this.github.repo(site.repoId)
    try {
      return await fn(site.repoFullName)
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 404) throw err
      const info = await client.info()
      if (info.fullName === site.repoFullName) throw err
      this.db.update(sites).set({ repoFullName: info.fullName }).where(eq(sites.id, site.id)).run()
      site.repoFullName = info.fullName
      return fn(info.fullName)
    }
  }

  async head(site: LinkedSite, opts: { fresh?: boolean } = {}): Promise<BranchHead> {
    const checked = site.headCheckedAt?.getTime() ?? 0
    if (!opts.fresh && site.headSha && site.headTreeSha && Date.now() - checked < this.#headTtl()) {
      return { commitSha: site.headSha, treeSha: site.headTreeSha }
    }
    const head = await this.#withRepo(site, (name) =>
      this.github.repo(site.repoId).branchHead(name, site.branch),
    )
    const now = new Date()
    this.db
      .update(sites)
      .set({ headSha: head.commitSha, headTreeSha: head.treeSha, headCheckedAt: now })
      .where(eq(sites.id, site.id))
      .run()
    Object.assign(site, { headSha: head.commitSha, headTreeSha: head.treeSha, headCheckedAt: now })
    return head
  }

  async tree(
    site: LinkedSite,
    treeSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const cached = this.db.select().from(gitTrees).where(eq(gitTrees.sha, treeSha)).get()
    if (cached) return { entries: cached.entries, truncated: cached.truncated }
    const tree = await this.#withRepo(site, (name) =>
      this.github.repo(site.repoId).tree(name, treeSha),
    )
    this.db
      .insert(gitTrees)
      .values({ sha: treeSha, ...tree })
      .onConflictDoNothing()
      .run()
    return tree
  }

  async blob(site: LinkedSite, sha: string): Promise<Buffer> {
    const cached = this.db.select().from(gitBlobs).where(eq(gitBlobs.sha, sha)).get()
    if (cached) return cached.content
    const content = await this.#withRepo(site, (name) =>
      this.github.repo(site.repoId).blob(name, sha),
    )
    this.db
      .insert(gitBlobs)
      .values({ sha, content, size: content.length })
      .onConflictDoNothing()
      .run()
    return content
  }

  /** Commits on the site's branch that changed `path`, newest first. */
  async history(site: LinkedSite, path: string): Promise<FileCommit[]> {
    const head = await this.head(site)
    const key = `${site.repoId}:${head.commitSha}:${path}`
    const cached = histories.get(key)
    if (cached) return cached
    const commits = await this.#withRepo(site, (name) =>
      this.github.repo(site.repoId).fileCommits(name, head.commitSha, path, HISTORY_LIMIT),
    )
    histories.set(key, commits)
    return commits
  }

  /** A file as it was in a commit, or null if it didn't exist there. */
  async fileAt(site: LinkedSite, commitSha: string, path: string): Promise<Buffer | null> {
    const key = `${site.repoId}:${commitSha}:${path}`
    if (filesAtCommit.has(key)) {
      const sha = filesAtCommit.get(key)
      return sha ? this.blob(site, sha) : null
    }
    const file = await this.#withRepo(site, (name) =>
      this.github.repo(site.repoId).fileAt(name, path, commitSha),
    )
    filesAtCommit.set(key, file?.sha ?? null)
    if (!file) return null
    if (!file.content) return this.blob(site, file.sha)
    this.db
      .insert(gitBlobs)
      .values({ sha: file.sha, content: file.content, size: file.content.length })
      .onConflictDoNothing()
      .run()
    return file.content
  }

  /** Reads a file at the current head of the site's branch, or null if it doesn't exist. */
  async readFile(site: LinkedSite, path: string): Promise<Buffer | null> {
    const head = await this.head(site)
    const { entries } = await this.tree(site, head.treeSha)
    const entry = entries.find((e) => e.type === 'blob' && e.path === path)
    return entry ? this.blob(site, entry.sha) : null
  }
}
