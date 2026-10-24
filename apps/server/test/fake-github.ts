import { createHash, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import type { TreeEntry } from '../src/db/schema'

interface FakeRepo {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
  branches: Map<string, { commitSha: string; treeSha: string }>
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
    tokens: new Map<string, IssuedToken>(),
    tokenRequests: [] as IssuedToken[],
    requests: [] as string[],
  }

  function commit(repoId: number, branch: string, files: Record<string, string>) {
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
    repo.branches.set(branch, { commitSha, treeSha })
    return { commitSha, treeSha }
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
    const blob = rest.match(/^git\/blobs\/(\w+)$/)
    if (blob) {
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

  return { appId, org, privateKey, state, fetch: fetchImpl, addRepo, commit }
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>
