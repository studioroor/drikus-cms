import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { PublishService } from '../src/content/publish'
import { ContentService } from '../src/content/service'
import { drafts, publishes, siteMembers, sites } from '../src/db/schema'
import { isLinked, SiteSync } from '../src/github/sync'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, PASSWORD, setup } from './helpers'

const CONFIG = `
collections:
  - name: posts
    folder: src/content/posts
    fields:
      - { name: title, required: true }
      - { name: date, type: date, required: true }
      - { name: body, type: markdown }
  - name: home
    file: src/content/pages/home.json
    fields: [{ name: heading }]
`

const REPO = 1001

async function world() {
  const gh = fakeGitHub()
  gh.addRepo(REPO, 'studioroor/bakkerij', {
    '.drikus/config.yml': CONFIG,
    'src/content/posts/oud.md': '---\ntitle: Oud\ndate: 2026-01-01\n---\n\nOud bericht.\n',
    'src/content/posts/weg.md': '---\ntitle: Weg\ndate: 2026-02-01\n---\n',
    'src/content/pages/home.json': '{\n  "heading": "Welkom"\n}\n',
    'README.md': '# Bakkerij\n',
  })
  gh.addRepo(1002, 'studioroor/kapper', { '.drikus/config.yml': CONFIG })
  const ctx = setup({}, githubFor(gh))
  const admin = await adminClient(ctx)
  const siteId = (await admin.post('/api/admin/sites', { name: 'Bakkerij', repoId: REPO })).json
    .id as string
  const otherSite = (await admin.post('/api/admin/sites', { name: 'Kapper', repoId: 1002 })).json
    .id as string
  const anna = await ctx.createUser({ email: 'anna@bakkerij.nl' })
  ctx.deps.db.insert(siteMembers).values({ siteId, userId: anna.id }).run()
  const editor = ctx.client()
  await editor.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
  const base = `/api/sites/${siteId}`
  const entry = (collection: string, slug: string) =>
    `${base}/collections/${collection}/entries/${slug}`
  const headSha = () => gh.state.repos.get(REPO)?.branches.get('main')?.commitSha
  return { gh, ctx, admin, editor, siteId, otherSite, base, entry, anna, headSha }
}

/** Simulates someone pushing directly to GitHub. */
function push(w: Awaited<ReturnType<typeof world>>, changes: Record<string, string>) {
  w.gh.commit(REPO, 'main', { ...w.gh.filesAt(REPO), ...changes })
}

describe('publishing', () => {
  test('commits all drafts as one commit on top of the branch', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'oud'), {
      data: { title: 'Nieuw', date: '2026-01-01', body: 'Nieuw bericht.' },
    })
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    await w.editor.del(w.entry('posts', 'weg'))
    await w.editor.post(`${w.base}/collections/posts/entries`, {
      data: { title: 'Taart', date: '2026-10-24' },
    })
    const before = w.headSha()
    w.gh.state.tokenRequests.length = 0

    const preview = await w.editor.get(`${w.base}/publish`)
    expect(preview.json.problems).toEqual([])
    expect(preview.json.changes).toHaveLength(4)

    const res = await w.editor.post(`${w.base}/publish`, { message: 'Nieuwe taart' })
    expect(res.status).toBe(200)
    const commitSha = res.json.publish.commitSha
    expect(w.headSha()).toBe(commitSha)

    const commit = w.gh.state.commits.get(commitSha)
    expect(commit?.parents).toEqual([before as string])
    expect(commit?.author.name).toBe('anna')
    expect(commit?.message).toStartWith('Nieuwe taart\n\n')
    expect(commit?.message).toContain('- deleted src/content/posts/weg.md')
    expect(commit?.message).toContain('Drikus-CMS-User: anna')

    expect(w.gh.filesAt(REPO)).toEqual({
      '.drikus/config.yml': CONFIG,
      'README.md': '# Bakkerij\n',
      'src/content/posts/oud.md': '---\ntitle: Nieuw\ndate: 2026-01-01\n---\n\nNieuw bericht.\n',
      'src/content/posts/taart.md': '---\ntitle: Taart\ndate: 2026-10-24\n---\n',
      'src/content/pages/home.json': '{\n  "heading": "Hallo"\n}\n',
    })
    // Writes used a token for this repository only.
    const writes = w.gh.state.tokenRequests.filter((t) => t.permissions.contents === 'write')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((t) => JSON.stringify(t.repoIds) === `[${REPO}]`)).toBe(true)

    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
    expect(w.ctx.deps.db.select().from(sites).where(eq(sites.id, w.siteId)).get()?.headSha).toBe(
      commitSha,
    )
    // The CMS reads the new version without another publish.
    expect((await w.editor.get(w.entry('posts', 'oud'))).json).toMatchObject({
      status: 'published',
      data: { title: 'Nieuw' },
    })
    const history = await w.editor.get(`${w.base}/publishes`)
    expect(history.json.publishes).toHaveLength(1)
    expect(history.json.publishes[0]).toMatchObject({ userName: 'anna', commitUrl: null })
    expect((await w.admin.get(`${w.base}/publishes`)).json.publishes[0].commitUrl).toBe(
      `https://github.com/studioroor/bakkerij/commit/${commitSha}`,
    )
  })

  test('refuses when there is nothing to publish', async () => {
    const w = await world()
    expect((await w.editor.post(`${w.base}/publish`, {})).json.error).toBe('nothing_to_publish')
  })

  test('blocks on empty required fields', async () => {
    const w = await world()
    await w.editor.post(`${w.base}/collections/posts/entries`, { data: { title: 'Zonder datum' } })
    const preview = await w.editor.get(`${w.base}/publish`)
    expect(preview.json.problems).toEqual([
      {
        kind: 'required',
        collection: 'posts',
        slug: 'zonder-datum',
        title: 'Zonder datum',
        fields: ['date'],
      },
    ])
    const res = await w.editor.post(`${w.base}/publish`, {})
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('publish_blocked')
    expect(w.gh.state.commits.size).toBe(0)
  })

  test('detects conflicts with changes made on GitHub, and can keep mine', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'oud'), { data: { title: 'Van Anna', date: '2026-01-01' } })
    push(w, { 'src/content/posts/oud.md': '---\ntitle: Van Drikus\ndate: 2026-01-01\n---\n' })

    const preview = await w.editor.get(`${w.base}/publish`)
    expect(preview.json.problems).toEqual([
      { kind: 'conflict', collection: 'posts', slug: 'oud', title: 'Van Anna' },
    ])
    expect((await w.editor.post(`${w.base}/publish`, {})).json.error).toBe('publish_blocked')

    await w.editor.post(`${w.entry('posts', 'oud')}/resolve`, { keep: 'mine' })
    expect((await w.editor.post(`${w.base}/publish`, {})).status).toBe(200)
    expect(w.gh.filesAt(REPO)['src/content/posts/oud.md']).toContain('Van Anna')
  })

  test('can resolve a conflict by keeping the website version', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'oud'), { data: { title: 'Van Anna', date: '2026-01-01' } })
    push(w, { 'src/content/posts/oud.md': '---\ntitle: Van Drikus\ndate: 2026-01-01\n---\n' })
    await w.editor.post(`${w.entry('posts', 'oud')}/resolve`, { keep: 'theirs' })
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
    expect((await w.editor.get(w.entry('posts', 'oud'))).json.data.title).toBe('Van Drikus')
  })

  test('keeps unrelated changes pushed to GitHub', async () => {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    push(w, { 'README.md': '# Bakkerij Jansen\n' })
    expect((await w.editor.post(`${w.base}/publish`, {})).status).toBe(200)
    expect(w.gh.filesAt(REPO)['README.md']).toBe('# Bakkerij Jansen\n')
    expect(w.gh.filesAt(REPO)['src/content/pages/home.json']).toContain('Hallo')
  })

  test('retries on top of a push that lands while publishing', async () => {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    w.gh.state.beforeRefUpdate = () => push(w, { 'README.md': '# Tegelijk gepusht\n' })
    const res = await w.editor.post(`${w.base}/publish`, {})
    expect(res.status).toBe(200)
    const files = w.gh.filesAt(REPO)
    expect(files['README.md']).toBe('# Tegelijk gepusht\n')
    expect(files['src/content/pages/home.json']).toContain('Hallo')
    expect(w.gh.state.commits.get(w.headSha() as string)?.parents).toHaveLength(1)
  })

  test('stops if a push during publishing conflicts with a draft', async () => {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    w.gh.state.beforeRefUpdate = () =>
      push(w, { 'src/content/pages/home.json': '{"heading":"Anders"}\n' })
    const res = await w.editor.post(`${w.base}/publish`, {})
    expect(res.json).toMatchObject({
      error: 'publish_blocked',
      issues: [{ kind: 'conflict', slug: '_' }],
    })
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(1)
  })

  test('an edit saved while publishing stays as a draft on top of the new version', async () => {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Eerste' } })
    w.gh.state.beforeRefUpdate = () => {
      w.ctx.deps.db
        .update(drafts)
        .set({
          data: { heading: 'Tweede' },
          content: '{\n  "heading": "Tweede"\n}\n',
          updatedAt: new Date(Date.now() + 1000),
        })
        .run()
    }
    expect((await w.editor.post(`${w.base}/publish`, {})).status).toBe(200)
    expect(w.gh.filesAt(REPO)['src/content/pages/home.json']).toContain('Eerste')
    const preview = await w.editor.get(`${w.base}/publish`)
    expect(preview.json).toMatchObject({
      changes: [{ slug: '_', status: 'modified' }],
      problems: [],
    })
    expect((await w.editor.post(`${w.base}/publish`, {})).status).toBe(200)
    expect(w.gh.filesAt(REPO)['src/content/pages/home.json']).toContain('Tweede')
  })

  test('only one publish per site at a time', async () => {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    const { db, github } = w.ctx.deps
    const site = db.select().from(sites).where(eq(sites.id, w.siteId)).get()
    if (!site || !isLinked(site) || !github) throw new Error('setup')
    const service = () =>
      new PublishService(new ContentService(db, new SiteSync(db, github), { ...site }))
    const [first, second] = await Promise.allSettled([
      service().publish(w.anna),
      service().publish(w.anna),
    ])
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'publish_in_progress' } })
  })

  test('editors cannot publish other sites', async () => {
    const w = await world()
    expect((await w.editor.post(`/api/sites/${w.otherSite}/publish`, {})).status).toBe(404)
    expect((await w.editor.get(`/api/sites/${w.otherSite}/publishes`)).status).toBe(404)
  })
})

describe('deploy status', () => {
  async function published() {
    const w = await world()
    await w.editor.put(w.entry('home', '_'), { data: { heading: 'Hallo' } })
    const res = await w.editor.post(`${w.base}/publish`, {})
    const status = () => w.editor.get(`${w.base}/publishes/${res.json.publish.id}/status`)
    return {
      ...w,
      sha: res.json.publish.commitSha as string,
      status,
      publishId: res.json.publish.id as string,
    }
  }

  test('is pending until checks appear, then follows them', async () => {
    const w = await published()
    expect((await w.status()).json).toMatchObject({ state: 'pending', checks: [] })

    w.gh.state.checkRuns.set(w.sha, [
      { name: 'deploy', status: 'in_progress', conclusion: null, details_url: 'https://ci/1' },
    ])
    expect((await w.status()).json).toMatchObject({
      state: 'pending',
      checks: [{ name: 'deploy', state: 'pending', url: 'https://ci/1' }],
    })

    w.gh.state.checkRuns.set(w.sha, [
      { name: 'deploy', status: 'completed', conclusion: 'success', details_url: null },
    ])
    w.gh.state.statuses.set(w.sha, [
      { context: 'Cloudflare Pages', state: 'success', target_url: 'https://x.pages.dev' },
    ])
    expect((await w.status()).json.state).toBe('success')
    expect(w.ctx.deps.db.select().from(publishes).get()?.deployState).toBe('success')
  })

  test('reports failures', async () => {
    const w = await published()
    w.gh.state.statuses.set(w.sha, [
      { context: 'Cloudflare Pages', state: 'failure', target_url: null },
    ])
    expect((await w.status()).json.state).toBe('failure')
  })

  test('reports "none" when a repo has no checks at all', async () => {
    const w = await published()
    w.ctx.deps.db
      .update(publishes)
      .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
      .run()
    expect((await w.status()).json.state).toBe('none')
  })

  test('cannot read publishes of another site', async () => {
    const w = await published()
    expect(
      (await w.editor.get(`/api/sites/${w.otherSite}/publishes/${w.publishId}/status`)).status,
    ).toBe(404)
    expect(
      (await w.admin.get(`/api/sites/${w.otherSite}/publishes/${w.publishId}/status`)).status,
    ).toBe(404)
  })
})
