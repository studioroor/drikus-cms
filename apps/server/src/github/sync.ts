import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { gitBlobs, gitTrees, type Site, sites, type TreeEntry } from '../db/schema'
import { type BranchHead, type GitHubApp, GitHubError } from './app'

/** Without webhooks, re-check the branch head at most this often. */
const HEAD_TTL_POLLING_MS = 15 * 1000
/** With working webhooks, pushes update the head for us; re-check only occasionally. */
const HEAD_TTL_WEBHOOKS_MS = 5 * 60 * 1000
const WEBHOOK_HEALTHY_MS = 24 * 60 * 60 * 1000

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

  /** Reads a file at the current head of the site's branch, or null if it doesn't exist. */
  async readFile(site: LinkedSite, path: string): Promise<Buffer | null> {
    const head = await this.head(site)
    const { entries } = await this.tree(site, head.treeSha)
    const entry = entries.find((e) => e.type === 'blob' && e.path === path)
    return entry ? this.blob(site, entry.sha) : null
  }
}
