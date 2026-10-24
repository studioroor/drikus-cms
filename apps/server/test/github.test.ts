import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { sites } from '../src/db/schema'
import { GitHubApp } from '../src/github/app'
import { SiteSync } from '../src/github/sync'
import { verifyWebhookSignature } from '../src/github/webhook'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, ORIGIN, PASSWORD, setup, WEBHOOK_SECRET } from './helpers'

const BAKERY = 1001
const BARBER = 1002

function world() {
  const gh = fakeGitHub()
  gh.addRepo(BAKERY, 'studioroor/bakkerij-jansen', {
    '.drikus/config.yml': 'collections: []\n',
    'src/content/pages/home.json': '{"title":"Welkom"}',
  })
  gh.addRepo(BARBER, 'studioroor/kapper-piet', { 'README.md': '# Kapper Piet' })
  const github = githubFor(gh)
  const ctx = setup({}, github)
  return { gh, github, ctx }
}

async function linkedSite(w: ReturnType<typeof world>, repoId = BAKERY) {
  const admin = await adminClient(w.ctx)
  const res = await admin.post('/api/admin/sites', { name: 'Bakkerij Jansen', repoId })
  expect(res.status).toBe(201)
  return { admin, siteId: res.json.id as string }
}

function signedWebhook(event: string, payload: unknown, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload)
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    body,
  }
}

describe('GitHub App auth', () => {
  test('authenticates with a signed JWT and finds the installation', async () => {
    const { github } = world()
    expect(await github.getApp()).toMatchObject({ name: 'Studio Roor CMS' })
    expect(await github.installationId()).toBe(4242)
  })

  test('caches installation tokens per scope', async () => {
    const { gh, github } = world()
    await github.token([BAKERY], { contents: 'read' })
    await github.token([BAKERY], { contents: 'read' })
    await github.token([BARBER], { contents: 'read' })
    expect(gh.state.tokenRequests).toEqual([
      { repoIds: [BAKERY], permissions: { contents: 'read' } },
      { repoIds: [BARBER], permissions: { contents: 'read' } },
    ])
  })

  test('lists repositories across pages', async () => {
    const gh = fakeGitHub()
    for (let i = 0; i < 130; i++)
      gh.addRepo(5000 + i, `studioroor/site-${String(i).padStart(3, '0')}`)
    const repos = await githubFor(gh).listRepositories()
    expect(repos).toHaveLength(130)
    expect(repos[0]?.fullName).toBe('studioroor/site-000')
  })

  test('a repo-scoped token cannot read another repository', async () => {
    const { github } = world()
    const bakery = github.repo(BAKERY)
    await expect(bakery.branchHead('studioroor/kapper-piet', 'main')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('admin GitHub status', () => {
  test('reports when GitHub is not configured', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const res = await admin.get('/api/admin/github')
    expect(res.json).toMatchObject({ configured: false })
  })

  test('reports the app, org and repository count', async () => {
    const { ctx } = world()
    const admin = await adminClient(ctx)
    const res = await admin.get('/api/admin/github')
    expect(res.json).toMatchObject({
      configured: true,
      org: 'studioroor',
      app: { name: 'Studio Roor CMS' },
      repoCount: 2,
      error: null,
      webhook: { configured: true, lastReceivedAt: null },
    })
  })

  test('explains when the app is not installed', async () => {
    const { gh, ctx } = world()
    gh.state.installed = false
    const admin = await adminClient(ctx)
    const res = await admin.get('/api/admin/github')
    expect(res.json).toMatchObject({ configured: true, error: 'github_not_installed' })
  })

  test('is not available to editors', async () => {
    const { ctx } = world()
    await ctx.createUser({ email: 'anna@bakkerij.nl' })
    const anna = ctx.client()
    await anna.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
    expect((await anna.get('/api/admin/github')).status).toBe(403)
    expect((await anna.get('/api/admin/github/repos')).status).toBe(403)
  })
})

describe('linking sites to repositories', () => {
  test('links by repo ID and fills in the name and default branch', async () => {
    const w = world()
    const { admin, siteId } = await linkedSite(w)
    const list = await admin.get('/api/admin/sites')
    expect(list.json.sites[0]).toMatchObject({
      id: siteId,
      repoId: BAKERY,
      repoFullName: 'studioroor/bakkerij-jansen',
      branch: 'main',
    })
    const repos = await admin.get('/api/admin/github/repos')
    expect(
      repos.json.repos.map((r: { fullName: string; siteId: string | null }) => [
        r.fullName,
        r.siteId,
      ]),
    ).toEqual([
      ['studioroor/bakkerij-jansen', siteId],
      ['studioroor/kapper-piet', null],
    ])
  })

  test('rejects repositories the app cannot access', async () => {
    const { ctx } = world()
    const admin = await adminClient(ctx)
    const res = await admin.post('/api/admin/sites', { name: 'X', repoId: 999 })
    expect(res.json.error).toBe('repo_not_accessible')
  })

  test('rejects unknown branches', async () => {
    const { ctx } = world()
    const admin = await adminClient(ctx)
    const res = await admin.post('/api/admin/sites', { name: 'X', repoId: BAKERY, branch: 'nope' })
    expect(res.json.error).toBe('branch_not_found')
  })

  test('picks up repos added to the installation later', async () => {
    const w = world()
    const admin = await adminClient(w.ctx)
    await admin.get('/api/admin/github/repos')
    w.gh.addRepo(1003, 'studioroor/new-client')
    const res = await admin.post('/api/admin/sites', { name: 'New', repoId: 1003 })
    expect(res.status).toBe(201)
  })

  test('a repository can only belong to one site', async () => {
    const w = world()
    const { admin } = await linkedSite(w)
    const res = await admin.post('/api/admin/sites', { name: 'Again', repoId: BAKERY })
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('repo_in_use')
  })

  test('changes branch, switches repo and unlinks', async () => {
    const w = world()
    w.gh.commit(BAKERY, 'staging', { 'a.txt': 'a' })
    const { admin, siteId } = await linkedSite(w)
    expect((await admin.patch(`/api/admin/sites/${siteId}`, { branch: 'staging' })).status).toBe(
      200,
    )
    expect(
      (await admin.patch(`/api/admin/sites/${siteId}`, { branch: 'missing' })).json.error,
    ).toBe('branch_not_found')
    expect((await admin.patch(`/api/admin/sites/${siteId}`, { repoId: BARBER })).status).toBe(200)
    let site = w.ctx.deps.db.select().from(sites).where(eq(sites.id, siteId)).get()
    expect(site).toMatchObject({
      repoId: BARBER,
      repoFullName: 'studioroor/kapper-piet',
      branch: 'main',
    })
    await admin.patch(`/api/admin/sites/${siteId}`, { repoId: null })
    site = w.ctx.deps.db.select().from(sites).where(eq(sites.id, siteId)).get()
    expect(site).toMatchObject({ repoId: null, repoFullName: null, headSha: null })
  })
})

describe('connection check and caching', () => {
  test('reads the repository with a token scoped to that repository only', async () => {
    const w = world()
    const { admin, siteId } = await linkedSite(w)
    w.gh.state.tokenRequests.length = 0
    const res = await admin.get(`/api/admin/sites/${siteId}/check`)
    expect(res.json).toMatchObject({
      repoFullName: 'studioroor/bakkerij-jansen',
      branch: 'main',
      fileCount: 2,
      configPath: '.drikus/config.yml',
    })
    expect(w.gh.state.tokenRequests.every((t) => JSON.stringify(t.repoIds) === `[${BAKERY}]`)).toBe(
      true,
    )
  })

  test('caches trees and blobs by SHA', async () => {
    const w = world()
    const { siteId } = await linkedSite(w)
    const site = w.ctx.deps.db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site?.repoId || !site.repoFullName) throw new Error('not linked')
    const sync = new SiteSync(w.ctx.deps.db, w.github)
    const linked = { ...site, repoId: site.repoId, repoFullName: site.repoFullName }

    expect((await sync.readFile(linked, 'src/content/pages/home.json'))?.toString()).toBe(
      '{"title":"Welkom"}',
    )
    expect(await sync.readFile(linked, 'missing.txt')).toBeNull()
    const before = w.gh.state.requests.length
    await sync.readFile(linked, 'src/content/pages/home.json')
    // Head is fresh, tree and blob are cached: no GitHub calls at all.
    expect(w.gh.state.requests.length).toBe(before)
  })

  test('follows repository renames', async () => {
    const w = world()
    const { admin, siteId } = await linkedSite(w)
    const repo = w.gh.state.repos.get(BAKERY)
    if (repo) repo.fullName = 'studioroor/bakkerij-jansen-2026'
    const res = await admin.get(`/api/admin/sites/${siteId}/check`)
    expect(res.json.repoFullName).toBe('studioroor/bakkerij-jansen-2026')
  })

  test('reports unlinked sites', async () => {
    const { ctx } = world()
    const admin = await adminClient(ctx)
    const site = await admin.post('/api/admin/sites', { name: 'No repo' })
    expect((await admin.get(`/api/admin/sites/${site.json.id}/check`)).json.error).toBe(
      'site_not_linked',
    )
  })
})

describe('webhooks', () => {
  test('verifies signatures in constant time', () => {
    const sig = `sha256=${createHmac('sha256', 's').update('body').digest('hex')}`
    expect(verifyWebhookSignature('s', 'body', sig)).toBe(true)
    expect(verifyWebhookSignature('s', 'body2', sig)).toBe(false)
    expect(verifyWebhookSignature('s', 'body', 'sha256=short')).toBe(false)
    expect(verifyWebhookSignature('s', 'body', undefined)).toBe(false)
  })

  test('rejects bad signatures and is disabled without a secret', async () => {
    const { ctx } = world()
    const bad = await ctx.app.request(
      '/api/github/webhook',
      signedWebhook('ping', {}, 'wrong-secret'),
    )
    expect(bad.status).toBe(401)

    const gh = fakeGitHub()
    const noSecret = setup(
      {},
      new GitHubApp({ appId: gh.appId, privateKey: gh.privateKey, org: gh.org, fetch: gh.fetch }),
    )
    expect(
      (await noSecret.app.request('/api/github/webhook', signedWebhook('ping', {}))).status,
    ).toBe(404)
  })

  test('push events update the cached head without a CSRF header or session', async () => {
    const w = world()
    const { siteId } = await linkedSite(w)
    const push = (ref: string, after: string) =>
      w.ctx.app.request(
        '/api/github/webhook',
        signedWebhook('push', {
          ref,
          after,
          head_commit: { tree_id: `tree-${after}` },
          repository: { id: BAKERY, full_name: 'studioroor/bakkerij-jansen' },
        }),
      )
    const res = await push('refs/heads/main', 'abc123')
    expect(res.status).toBe(200)
    let site = w.ctx.deps.db.select().from(sites).where(eq(sites.id, siteId)).get()
    expect(site).toMatchObject({ headSha: 'abc123', headTreeSha: 'tree-abc123' })
    expect(w.github.lastWebhookAt).not.toBeNull()

    await push('refs/heads/feature', 'def456')
    site = w.ctx.deps.db.select().from(sites).where(eq(sites.id, siteId)).get()
    expect(site?.headSha).toBe('abc123')
  })

  test('installation changes refresh the repository list', async () => {
    const w = world()
    const admin = await adminClient(w.ctx)
    expect((await admin.get('/api/admin/github/repos')).json.repos).toHaveLength(2)
    w.gh.addRepo(1003, 'studioroor/new-client')
    expect((await admin.get('/api/admin/github/repos')).json.repos).toHaveLength(2)
    await w.ctx.app.request(
      '/api/github/webhook',
      signedWebhook('installation_repositories', { action: 'added' }),
    )
    expect((await admin.get('/api/admin/github/repos')).json.repos).toHaveLength(3)
  })

  test('webhook endpoint ignores the session origin check', async () => {
    const { ctx } = world()
    const res = await ctx.app.request('/api/github/webhook', {
      ...signedWebhook('ping', { zen: 'hi' }),
      headers: { ...signedWebhook('ping', { zen: 'hi' }).headers, origin: 'https://github.com' },
    })
    expect(res.status).toBe(200)
    expect(ORIGIN).not.toBe('https://github.com')
  })
})
