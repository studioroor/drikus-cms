import { createPrivateKey, createSign, type KeyObject } from 'node:crypto'
import type { TreeEntry } from '../db/schema'

const API_VERSION = '2022-11-28'
/** Installation tokens live 60 minutes; refresh well before that. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
const REPO_LIST_TTL_MS = 5 * 60 * 1000

export type Permission = 'contents' | 'metadata' | 'checks' | 'statuses' | 'actions'
export type Permissions = Partial<Record<Permission, 'read' | 'write'>>

export interface RepoInfo {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
  description: string | null
  /** The repo's website: its configured homepage, else its GitHub Pages URL. */
  siteUrl: string | null
}

export interface TreeChange {
  path: string
  /** New text content, binary content (uploads), or null to delete the file. */
  content: string | Buffer | null
}

export interface CommitCheck {
  name: string
  state: 'pending' | 'success' | 'failure'
  url: string | null
}

export interface FileCommit {
  sha: string
  message: string
  authorName: string
  /** ISO date of the commit. */
  date: string
}

export interface BranchHead {
  commitSha: string
  treeSha: string
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: 'not_installed',
  ) {
    super(message)
  }
}

export interface GitHubAppOptions {
  appId: string
  privateKey: string
  /** The account the app is installed on, e.g. `studioroor`. */
  org: string
  webhookSecret?: string
  apiUrl?: string
  fetch?: typeof fetch
}

/**
 * Talks to GitHub as the Drikus CMS GitHub App. Every repository call uses an
 * installation token scoped to that single repository, so even a bug elsewhere
 * can't make the CMS write to another client's repo.
 */
export class GitHubApp {
  readonly org: string
  readonly webhookSecret: string | undefined
  /** When the last valid webhook arrived (null until one does). */
  lastWebhookAt: Date | null = null

  readonly #appId: string
  readonly #key: KeyObject
  readonly #apiUrl: string
  readonly #fetch: typeof fetch
  #installationId: number | undefined
  readonly #tokens = new Map<string, { token: string; expiresAt: number }>()
  #repos: { at: number; list: RepoInfo[] } | undefined

  constructor(opts: GitHubAppOptions) {
    this.#appId = opts.appId
    this.#key = createPrivateKey(opts.privateKey)
    this.org = opts.org
    this.webhookSecret = opts.webhookSecret || undefined
    this.#apiUrl = (opts.apiUrl ?? 'https://api.github.com').replace(/\/$/, '')
    this.#fetch = opts.fetch ?? fetch
  }

  /** A short-lived JWT that authenticates as the app itself (RS256). */
  appJwt(now = Date.now()): string {
    const iat = Math.floor(now / 1000) - 60 // allow for clock drift
    const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat, exp: iat + 9 * 60, iss: this.#appId })}`
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.#key)
      .toString('base64url')
    return `${unsigned}.${signature}`
  }

  async request<T>(
    path: string,
    opts: { auth: string; method?: string; body?: unknown; scheme?: 'Bearer' | 'token' },
  ): Promise<T> {
    const res = await this.#fetch(`${this.#apiUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `${opts.scheme ?? 'Bearer'} ${opts.auth}`,
        'user-agent': 'drikus-cms',
        'x-github-api-version': API_VERSION,
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      throw new GitHubError(res.status, body.message ?? res.statusText)
    }
    return (await res.json()) as T
  }

  async getApp() {
    const app = await this.request<{ slug: string; name: string; html_url: string }>('/app', {
      auth: this.appJwt(),
    })
    return { slug: app.slug, name: app.name, htmlUrl: app.html_url }
  }

  async installationId(): Promise<number> {
    if (this.#installationId) return this.#installationId
    try {
      const inst = await this.request<{ id: number }>(
        `/orgs/${encodeURIComponent(this.org)}/installation`,
        { auth: this.appJwt() },
      )
      this.#installationId = inst.id
      return inst.id
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        throw new GitHubError(
          404,
          `The GitHub App is not installed on ${this.org}`,
          'not_installed',
        )
      }
      throw err
    }
  }

  /**
   * Returns an installation token limited to the given repositories and
   * permissions. Pass `null` for repositories only when listing what the
   * installation can see.
   */
  async token(repoIds: number[] | null, permissions: Permissions): Promise<string> {
    const key = JSON.stringify([repoIds, permissions])
    const cached = this.#tokens.get(key)
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token

    const installationId = await this.installationId()
    const res = await this.request<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      {
        auth: this.appJwt(),
        method: 'POST',
        body: { ...(repoIds ? { repository_ids: repoIds } : {}), permissions },
      },
    )
    this.#tokens.set(key, { token: res.token, expiresAt: Date.parse(res.expires_at) })
    return res.token
  }

  /** Repositories the installation has access to (cached for a few minutes). */
  async listRepositories(opts: { refresh?: boolean } = {}): Promise<RepoInfo[]> {
    if (!opts.refresh && this.#repos && Date.now() - this.#repos.at < REPO_LIST_TTL_MS) {
      return this.#repos.list
    }
    const token = await this.token(null, { metadata: 'read' })
    const list: RepoInfo[] = []
    for (let page = 1; page <= 50; page++) {
      const res = await this.request<{ total_count: number; repositories: GitHubRepo[] }>(
        `/installation/repositories?per_page=100&page=${page}`,
        { auth: token },
      )
      list.push(...res.repositories.map(toRepoInfo))
      if (res.repositories.length < 100 || list.length >= res.total_count) break
    }
    list.sort((a, b) => a.fullName.localeCompare(b.fullName))
    this.#repos = { at: Date.now(), list }
    return list
  }

  /** Forget cached installation data, e.g. after repos were added to the app. */
  invalidateInstallation() {
    this.#repos = undefined
    this.#installationId = undefined
  }

  repo(repoId: number) {
    return new RepoClient(this, repoId)
  }
}

interface GitHubRepo {
  id: number
  full_name: string
  default_branch: string
  private: boolean
  html_url: string
  description?: string | null
  homepage?: string | null
  has_pages?: boolean
}

/** `https://owner.github.io/repo/`, or the root for an `owner.github.io` repo. */
function pagesUrl(fullName: string) {
  const [owner = '', name = ''] = fullName.toLowerCase().split('/')
  const host = `${owner}.github.io`
  return name === host ? `https://${host}/` : `https://${host}/${name}/`
}

function homepageUrl(homepage: string | null | undefined) {
  const value = homepage?.trim()
  if (!value) return null
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`
  return URL.canParse(url) ? url : null
}

function toRepoInfo(r: GitHubRepo): RepoInfo {
  return {
    id: r.id,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    htmlUrl: r.html_url,
    description: r.description?.trim() || null,
    siteUrl: homepageUrl(r.homepage) ?? (r.has_pages ? pagesUrl(r.full_name) : null),
  }
}

/** Read access to a single repository, always through a token scoped to it. */
export class RepoClient {
  constructor(
    readonly app: GitHubApp,
    readonly repoId: number,
  ) {}

  #get<T>(path: string, permissions: Permissions = { contents: 'read' }) {
    return this.app
      .token([this.repoId], permissions)
      .then((auth) => this.app.request<T>(path, { auth }))
  }

  /** Looks the repo up by ID, which also resolves its current name after a rename. */
  async info(): Promise<RepoInfo> {
    return toRepoInfo(
      await this.#get<GitHubRepo>(`/repositories/${this.repoId}`, { metadata: 'read' }),
    )
  }

  async branchHead(fullName: string, branch: string): Promise<BranchHead> {
    const res = await this.#get<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
      `/repos/${fullName}/branches/${encodeURIComponent(branch)}`,
    )
    return { commitSha: res.commit.sha, treeSha: res.commit.commit.tree.sha }
  }

  async tree(
    fullName: string,
    treeSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const res = await this.#get<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${fullName}/git/trees/${treeSha}?recursive=1`,
    )
    return {
      entries: res.tree.map(({ path, type, sha, size }) => ({
        path,
        type,
        sha,
        ...(size === undefined ? {} : { size }),
      })),
      truncated: res.truncated,
    }
  }

  /** Commits on `ref` that changed `path`, newest first. */
  async fileCommits(
    fullName: string,
    ref: string,
    path: string,
    limit: number,
  ): Promise<FileCommit[]> {
    const query = new URLSearchParams({ sha: ref, path, per_page: String(limit) })
    const res = await this.#get<
      {
        sha: string
        commit: { message: string; author: { name: string; date: string } | null }
      }[]
    >(`/repos/${fullName}/commits?${query}`)
    return res.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      authorName: c.commit.author?.name ?? '',
      date: c.commit.author?.date ?? '',
    }))
  }

  /**
   * A file as it was at `ref`: its blob SHA, plus the content when GitHub
   * includes it (files up to 1 MB). Null if the file didn't exist there.
   */
  async fileAt(
    fullName: string,
    path: string,
    ref: string,
  ): Promise<{ sha: string; content: Buffer | null } | null> {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    try {
      const res = await this.#get<{
        type: string
        sha: string
        content?: string
        encoding?: string
      }>(`/repos/${fullName}/contents/${encoded}?ref=${encodeURIComponent(ref)}`)
      if (res.type !== 'file') return null
      return {
        sha: res.sha,
        content:
          res.encoding === 'base64' && res.content ? Buffer.from(res.content, 'base64') : null,
      }
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null
      throw err
    }
  }

  #send<T>(path: string, method: 'POST' | 'PATCH', body: unknown) {
    return this.app
      .token([this.repoId], { contents: 'write' })
      .then((auth) => this.app.request<T>(path, { auth, method, body }))
  }

  /** Creates a tree on top of `baseTree`. Entries with `content: null` delete that path. */
  /** Uploads binary content as a blob and returns its SHA. */
  async createBlob(fullName: string, bytes: Buffer): Promise<string> {
    const res = await this.#send<{ sha: string }>(`/repos/${fullName}/git/blobs`, 'POST', {
      content: bytes.toString('base64'),
      encoding: 'base64',
    })
    return res.sha
  }

  async createTree(fullName: string, baseTree: string, changes: TreeChange[]): Promise<string> {
    // Text goes inline in the tree; binary files must be uploaded as blobs first.
    const entries = []
    for (const c of changes) {
      if (c.content === null)
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null })
      else if (typeof c.content === 'string')
        entries.push({ path: c.path, mode: '100644', type: 'blob', content: c.content })
      else
        entries.push({
          path: c.path,
          mode: '100644',
          type: 'blob',
          sha: await this.createBlob(fullName, c.content),
        })
    }
    const res = await this.#send<{ sha: string }>(`/repos/${fullName}/git/trees`, 'POST', {
      base_tree: baseTree,
      tree: entries,
    })
    return res.sha
  }

  async createCommit(
    fullName: string,
    commit: {
      message: string
      tree: string
      parent: string
      author: { name: string; email: string }
    },
  ): Promise<string> {
    const res = await this.#send<{ sha: string }>(`/repos/${fullName}/git/commits`, 'POST', {
      message: commit.message,
      tree: commit.tree,
      parents: [commit.parent],
      author: { ...commit.author, date: new Date().toISOString() },
    })
    return res.sha
  }

  /** Moves the branch to `sha`. Never forces: fails with 422 if the branch moved meanwhile. */
  async updateBranch(fullName: string, branch: string, sha: string): Promise<void> {
    await this.#send(`/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', {
      sha,
      force: false,
    })
  }

  /** Check runs and commit statuses for a commit (GitHub Actions, Cloudflare Pages, …). */
  async commitChecks(fullName: string, sha: string): Promise<CommitCheck[]> {
    const [runs, statuses] = await Promise.allSettled([
      this.#get<{
        check_runs: {
          name: string
          status: string
          conclusion: string | null
          html_url: string | null
          details_url: string | null
        }[]
      }>(`/repos/${fullName}/commits/${sha}/check-runs?per_page=100`, { checks: 'read' }),
      this.#get<{ statuses: { context: string; state: string; target_url: string | null }[] }>(
        `/repos/${fullName}/commits/${sha}/status`,
        { statuses: 'read' },
      ),
    ])
    if (runs.status === 'rejected' && statuses.status === 'rejected') throw runs.reason
    const checks: CommitCheck[] = []
    if (runs.status === 'fulfilled') {
      for (const r of runs.value.check_runs) {
        checks.push({
          name: r.name,
          state:
            r.status !== 'completed'
              ? 'pending'
              : ['success', 'neutral', 'skipped'].includes(r.conclusion ?? '')
                ? 'success'
                : 'failure',
          url: r.details_url ?? r.html_url,
        })
      }
    }
    if (statuses.status === 'fulfilled') {
      for (const st of statuses.value.statuses) {
        checks.push({
          name: st.context,
          state:
            st.state === 'success' ? 'success' : st.state === 'pending' ? 'pending' : 'failure',
          url: st.target_url,
        })
      }
    }
    return checks
  }

  async blob(fullName: string, sha: string): Promise<Buffer> {
    const res = await this.#get<{ content: string; encoding: string }>(
      `/repos/${fullName}/git/blobs/${sha}`,
    )
    if (res.encoding !== 'base64')
      throw new GitHubError(500, `Unexpected blob encoding ${res.encoding}`)
    return Buffer.from(res.content, 'base64')
  }
}
