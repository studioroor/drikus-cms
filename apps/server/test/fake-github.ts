import { createHash, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import type { TreeEntry } from '../src/db/schema'

interface FakeRepo {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
  description?: string
  homepage?: string
  hasPages?: boolean
  branches: Map<string, { commitSha: string; treeSha: string }>
}

interface FakeCommit {
  tree: string
  parents: string[]
  message: string
  author: { name: string; email: string; date?: string }
}

interface IssuedToken {
  repoIds: number[] | null
  permissions: Record<string, string>
}

const gitSha = (kind: string, content: string) =>
  createHash('sha1')
    .update(`${kind} ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex')

/**
 * In-memory stand-in for the GitHub REST API. It verifies the app JWT and
 * enforces installation-token repository scoping like GitHub does (404 for
 * repositories outside the token's scope).
 */
export function fakeGitHub(opts: { appId?: string; org?: string } = {}) {
  const appId = opts.appId ?? '12345'
  const org = opts.org ?? 'studioroor'
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const verifyKey = createPublicKey(publicKey)

  const state = {
    installed: true,
    installationId: 4242,
    repos: new Map<number, FakeRepo>(),
    trees: new Map<string, TreeEntry[]>(),
    blobs: new Map<string, string>(),
    /** Binary blobs uploaded through POST git/blobs (uploads), by their real Git SHA. */
    binaryBlobs: new Map<string, Buffer>(),
    tokens: new Map<string, IssuedToken>(),
    tokenRequests: [] as IssuedToken[],
    requests: [] as string[],
    /** Commits created through the API. */
    commits: new Map<string, FakeCommit>(),
    /** Commits pushed directly with `commit()`. */
    pushed: new Map<string, FakeCommit>(),
    checkRuns: new Map<
      string,
      { name: string; status: string; conclusion: string | null; details_url: string | null }[]
    >(),
    statuses: new Map<string, { context: string; state: string; target_url: string | null }[]>(),
    /** Runs once right before the next branch update, e.g. to simulate someone else pushing. */
    beforeRefUpdate: null as (() => void) | null,
  }

  /** Files of a branch as path → content. */
  function filesAt(repoId: number, branch = 'main') {
    const head = state.repos.get(repoId)?.branches.get(branch)
    const entries = head ? (state.trees.get(head.treeSha) ?? []) : []
    return Object.fromEntries(entries.map((e) => [e.path, state.blobs.get(e.sha) ?? '']))
  }

  /** Binary files of a branch as path → bytes. */
  function binaryAt(repoId: number, branch = 'main') {
    const head = state.repos.get(repoId)?.branches.get(branch)
    const entries = head ? (state.trees.get(head.treeSha) ?? []) : []
    return Object.fromEntries(
      entries
        .filter((e) => state.binaryBlobs.has(e.sha))
        .map((e) => [e.path, state.binaryBlobs.get(e.sha) as Buffer]),
    )
  }

  /** Pushes a commit whose tree is exactly `files` (on top of the branch's current head). */
  function commit(
    repoId: number,
    branch: string,
    files: Record<string, string>,
    meta: { message?: string; author?: string; date?: string } = {},
  ) {
    const repo = state.repos.get(repoId)
    if (!repo) throw new Error(`no repo ${repoId}`)
    const entries: TreeEntry[] = Object.entries(files).map(([path, content]) => {
      const sha = gitSha('blob', content)
      state.blobs.set(sha, content)
      return { path, type: 'blob', sha, size: Buffer.byteLength(content) }
    })
    const treeSha = gitSha('tree', JSON.stringify(entries))
    state.trees.set(treeSha, entries)
    const commitSha = gitSha('commit', `${treeSha}${Date.now()}${Math.random()}`)
    const parent = repo.branches.get(branch)?.commitSha
    const name = meta.author ?? 'Drikus'
    state.pushed.set(commitSha, {
      tree: treeSha,
      parents: parent ? [parent] : [],
      message: meta.message ?? 'Update',
      author: { name, email: `${name.toLowerCase()}@example.com`, date: meta.date },
    })
    repo.branches.set(branch, { commitSha, treeSha })
    return { commitSha, treeSha }
  }

  const commitOf = (sha: string) => state.commits.get(sha) ?? state.pushed.get(sha)

  const blobAt = (treeSha: string | undefined, path: string) =>
    (treeSha ? state.trees.get(treeSha) : undefined)?.find((e) => e.path === path)?.sha ?? null

  /** Like `git log --first-parent <ref> -- <path>`. */
  function fileLog(ref: string, path: string) {
    const log: string[] = []
    for (let sha: string | undefined = ref; sha; ) {
      const c = commitOf(sha)
      if (!c) break
      const parent = c.parents[0]
      if (blobAt(c.tree, path) !== blobAt(parent && commitOf(parent)?.tree, path)) {
        log.push(sha)
      }
      sha = parent
    }
    return log
  }

  function addRepo(
    id: number,
    fullName: string,
    files: Record<string, string> = {},
    branch = 'main',
  ) {
    state.repos.set(id, { id, fullName, defaultBranch: branch, private: true, branches: new Map() })
    return commit(id, branch, files)
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const notFound = () => json({ message: 'Not Found' }, 404)

  function verifyJwt(auth: string | null) {
    const token = auth?.replace(/^Bearer /, '') ?? ''
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return false
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(verifyKey, Buffer.from(signature, 'base64url'))
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return ok && claims.iss === appId && claims.exp > Date.now() / 1000
  }

  function installationToken(auth: string | null) {
    return state.tokens.get(auth?.replace(/^Bearer /, '') ?? '')
  }

  const repoJson = (r: FakeRepo) => ({
    id: r.id,
    full_name: r.fullName,
    default_branch: r.defaultBranch,
    private: r.private,
    html_url: `https://github.com/${r.fullName}`,
    description: r.description ?? null,
    homepage: r.homepage ?? null,
    has_pages: r.hasPages ?? false,
  })

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const method = init?.method ?? 'GET'
    const auth = new Headers(init?.headers).get('authorization')
    const path = url.pathname
    state.requests.push(`${method} ${path}`)

    // --- App-authenticated endpoints (JWT) ---
    if (path === '/app' || path.startsWith('/orgs/') || path.startsWith('/app/installations/')) {
      if (!verifyJwt(auth)) return json({ message: 'Bad credentials' }, 401)
      if (path === '/app')
        return json({
          slug: 'studio-roor-cms',
          name: 'Studio Roor CMS',
          html_url: 'https://github.com/apps/studio-roor-cms',
        })
      if (path === `/orgs/${org}/installation`)
        return state.installed ? json({ id: state.installationId }) : notFound()
      if (
        path === `/app/installations/${state.installationId}/access_tokens` &&
        method === 'POST'
      ) {
        if (!state.installed) return notFound()
        const body = JSON.parse(String(init?.body ?? '{}'))
        const issued = { repoIds: body.repository_ids ?? null, permissions: body.permissions ?? {} }
        const token = `ghs_${state.tokens.size + 1}`
        state.tokens.set(token, issued)
        state.tokenRequests.push(issued)
        return json({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201)
      }
      return notFound()
    }

    // --- Installation-token endpoints ---
    const token = installationToken(auth)
    if (!token) return json({ message: 'Bad credentials' }, 401)
    const visible = (r: FakeRepo) => token.repoIds === null || token.repoIds.includes(r.id)

    if (path === '/installation/repositories') {
      const all = [...state.repos.values()].filter(visible)
      const perPage = Number(url.searchParams.get('per_page') ?? 30)
      const page = Number(url.searchParams.get('page') ?? 1)
      return json({
        total_count: all.length,
        repositories: all.slice((page - 1) * perPage, page * perPage).map(repoJson),
      })
    }

    const byId = path.match(/^\/repositories\/(\d+)$/)
    if (byId) {
      const repo = state.repos.get(Number(byId[1]))
      return repo && visible(repo) ? json(repoJson(repo)) : notFound()
    }

    const m = path.match(/^\/repos\/([^/]+\/[^/]+)\/(.+)$/)
    const repo = m && [...state.repos.values()].find((r) => r.fullName === m[1])
    if (!m || !repo || !visible(repo)) return notFound()
    const rest = m[2] as string

    const branch = rest.match(/^branches\/(.+)$/)
    if (branch) {
      const head = repo.branches.get(decodeURIComponent(branch[1] as string))
      return head
        ? json({ commit: { sha: head.commitSha, commit: { tree: { sha: head.treeSha } } } })
        : json({ message: 'Branch not found' }, 404)
    }
    const tree = rest.match(/^git\/trees\/(\w+)$/)
    if (tree) {
      const entries = state.trees.get(tree[1] as string)
      return entries ? json({ sha: tree[1], tree: entries, truncated: false }) : notFound()
    }
    const canWrite = token.permissions.contents === 'write'
    if (rest === 'git/trees' && method === 'POST') {
      if (!canWrite) return json({ message: 'Resource not accessible by integration' }, 403)
      const body = JSON.parse(String(init?.body))
      const base = new Map((state.trees.get(body.base_tree) ?? []).map((e) => [e.path, e]))
      for (const change of body.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (change.sha === null) base.delete(change.path)
        else if (change.sha) {
          const bin = state.binaryBlobs.get(change.sha)
          if (!bin) return json({ message: 'Invalid tree info' }, 422)
          base.set(change.path, {
            path: change.path,
            type: 'blob',
            sha: change.sha,
            size: bin.length,
          })
        } else if (change.content !== undefined) {
          const sha = gitSha('blob', change.content)
          state.blobs.set(sha, change.content)
          base.set(change.path, {
            path: change.path,
            type: 'blob',
            sha,
            size: Buffer.byteLength(change.content),
          })
        }
      }
      const entries = [...base.values()].sort((a, b) => a.path.localeCompare(b.path))
      const sha = gitSha('tree', JSON.stringify(entries))
      state.trees.set(sha, entries)
      return json({ sha }, 201)
    }
    if (rest === 'git/blobs' && method === 'POST') {
      if (!canWrite) return json({ message: 'Resource not accessible by integration' }, 403)
      const body = JSON.parse(String(init?.body))
      const bytes = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
      state.binaryBlobs.set(sha, bytes)
      return json({ sha }, 201)
    }
    if (rest === 'git/commits' && method === 'POST') {
      if (!canWrite) return json({ message: 'Resource not accessible by integration' }, 403)
      const body = JSON.parse(String(init?.body))
      const sha = gitSha(
        'commit',
        `${body.tree}${body.parents.join()}${body.message}${Math.random()}`,
      )
      state.commits.set(sha, {
        tree: body.tree,
        parents: body.parents,
        message: body.message,
        author: body.author,
      })
      return json({ sha }, 201)
    }
    const ref = rest.match(/^git\/refs\/heads\/(.+)$/)
    if (ref && method === 'PATCH') {
      if (!canWrite) return json({ message: 'Resource not accessible by integration' }, 403)
      const hook = state.beforeRefUpdate
      state.beforeRefUpdate = null
      hook?.()
      const branchName = decodeURIComponent(ref[1] as string)
      const body = JSON.parse(String(init?.body))
      const current = repo.branches.get(branchName)
      const commit = state.commits.get(body.sha)
      if (!current || !commit) return json({ message: 'Reference does not exist' }, 422)
      if (!body.force && commit.parents[0] !== current.commitSha) {
        return json({ message: 'Update is not a fast forward' }, 422)
      }
      repo.branches.set(branchName, { commitSha: body.sha, treeSha: commit.tree })
      return json({ ref: `refs/heads/${branchName}`, object: { sha: body.sha } })
    }
    if (rest === 'commits' && method === 'GET') {
      const ref = url.searchParams.get('sha') ?? ''
      const head = repo.branches.get(ref)?.commitSha ?? ref
      const perPage = Number(url.searchParams.get('per_page') ?? 30)
      const path = url.searchParams.get('path') ?? ''
      return json(
        fileLog(head, path)
          .slice(0, perPage)
          .map((sha) => {
            const c = commitOf(sha)
            return {
              sha,
              commit: {
                message: c?.message,
                author: { ...c?.author, date: c?.author.date ?? '2026-10-01T12:00:00Z' },
              },
            }
          }),
      )
    }
    const contents = rest.match(/^contents\/(.+)$/)
    if (contents) {
      const path = (contents[1] as string).split('/').map(decodeURIComponent).join('/')
      const ref = url.searchParams.get('ref') ?? ''
      const sha = blobAt(commitOf(ref)?.tree, path)
      const content = sha ? state.blobs.get(sha) : undefined
      if (!sha || content === undefined) return notFound()
      return json({
        type: 'file',
        path,
        sha,
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64',
      })
    }
    const checks = rest.match(/^commits\/(\w+)\/(check-runs|status)$/)
    if (checks) {
      const [, sha, kind] = checks as [string, string, string]
      if (kind === 'check-runs') {
        if (token.permissions.checks !== 'read') return json({ message: 'Forbidden' }, 403)
        return json({ total_count: 0, check_runs: state.checkRuns.get(sha) ?? [] })
      }
      if (token.permissions.statuses !== 'read') return json({ message: 'Forbidden' }, 403)
      const list = state.statuses.get(sha) ?? []
      return json({ state: list.length ? list[0]?.state : 'pending', statuses: list })
    }
    const blob = rest.match(/^git\/blobs\/(\w+)$/)
    if (blob) {
      const bin = state.binaryBlobs.get(blob[1] as string)
      if (bin) return json({ sha: blob[1], content: bin.toString('base64'), encoding: 'base64' })
      const content = state.blobs.get(blob[1] as string)
      return content === undefined
        ? notFound()
        : json({
            sha: blob[1],
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64',
          })
    }
    return notFound()
  }) as typeof fetch

  return { appId, org, privateKey, state, fetch: fetchImpl, addRepo, commit, filesAt, binaryAt }
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>
