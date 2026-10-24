import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, drafts, siteMembers, sites } from '../src/db/schema'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, PASSWORD, setup } from './helpers'

const CONFIG = `
collections:
  - name: posts
    folder: src/content/posts
    fields:
      - { name: title, required: true }
      - { name: body, type: markdown }
  - name: home
    file: src/content/pages/home.json
    fields: [{ name: heading }]
`

const REPO = 1001
const post = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n${body}\n`
const V1 = post('Brood', 'Eerste versie.')
const V2 = post('Brood', 'Tweede versie.')
const V3 = post('Vers brood', 'Derde versie.')

/** A repo where the bread post went through three versions, by different people. */
async function world() {
  const gh = fakeGitHub()
  const files = {
    '.drikus/config.yml': CONFIG,
    'src/content/pages/home.json': '{\n  "heading": "Welkom"\n}\n',
  }
  gh.addRepo(REPO, 'studioroor/bakkerij', files)
  const at = (day: number) => `2026-10-0${day}T09:00:00Z`
  const v1 = gh.commit(
    REPO,
    'main',
    { ...files, 'src/content/posts/brood.md': V1 },
    { message: 'Add bread post', author: 'Drikus', date: at(1) },
  )
  // Unrelated commit: not part of the post's history.
  gh.commit(
    REPO,
    'main',
    { ...files, 'src/content/posts/brood.md': V1, 'README.md': '# Bakkerij\n' },
    { message: 'Readme', date: at(2) },
  )
  const v2 = gh.commit(
    REPO,
    'main',
    { ...files, 'src/content/posts/brood.md': V2, 'README.md': '# Bakkerij\n' },
    { message: 'Fix typo\n\nLonger description.', author: 'Anna', date: at(3) },
  )
  const v3 = gh.commit(
    REPO,
    'main',
    { ...files, 'src/content/posts/brood.md': V3, 'README.md': '# Bakkerij\n' },
    { message: 'New title', author: 'Anna', date: at(4) },
  )
  gh.addRepo(1002, 'studioroor/kapper', files)

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
  const entry = `/api/sites/${siteId}/collections/posts/entries/brood`
  const shas = { v1: v1.commitSha, v2: v2.commitSha, v3: v3.commitSha }
  return { gh, ctx, admin, editor, siteId, otherSite, entry, shas }
}

describe('revisions', () => {
  test('lists the commits that changed the entry, newest first', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.entry}/revisions`)
    expect(res.status).toBe(200)
    expect(res.json.live).toBe(true)
    expect(res.json.draft).toBeNull()
    expect(res.json.revisions).toEqual([
      {
        sha: w.shas.v3,
        message: 'New title',
        authorName: 'Anna',
        date: Date.parse('2026-10-04T09:00:00Z'),
      },
      {
        sha: w.shas.v2,
        message: 'Fix typo',
        authorName: 'Anna',
        date: Date.parse('2026-10-03T09:00:00Z'),
      },
      {
        sha: w.shas.v1,
        message: 'Add bread post',
        authorName: 'Drikus',
        date: Date.parse('2026-10-01T09:00:00Z'),
      },
    ])
  })

  test('shows the unpublished draft alongside the history', async () => {
    const w = await world()
    await w.editor.put(w.entry, { data: { title: 'Concept', body: 'Nog niet live.' } })
    const res = await w.editor.get(`${w.entry}/revisions`)
    expect(res.json.draft).toMatchObject({ action: 'upsert', updatedBy: { name: 'anna' } })
    expect((await w.editor.get(`${w.entry}/revisions/draft`)).json.data).toMatchObject({
      title: 'Concept',
    })
  })

  test('reads the data of an earlier version', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.entry}/revisions/${w.shas.v1}`)
    expect(res.json.data).toEqual({ title: 'Brood', body: 'Eerste versie.\n' })
    // Without a draft there's nothing to read as "draft".
    expect((await w.editor.get(`${w.entry}/revisions/draft`)).status).toBe(404)
  })

  test('only accepts commits from the entry’s own history', async () => {
    const w = await world()
    const other = w.gh.state.repos.get(1002)?.branches.get('main')?.commitSha
    expect((await w.editor.get(`${w.entry}/revisions/${other}`)).status).toBe(404)
    expect((await w.editor.get(`${w.entry}/revisions/${'a'.repeat(40)}`)).status).toBe(404)
    expect((await w.editor.get(`${w.entry}/revisions/main`)).status).toBe(400)
    expect((await w.editor.post(`${w.entry}/revisions/draft/restore`)).status).toBe(400)
  })

  test('editors cannot see revisions of other sites', async () => {
    const w = await world()
    const url = `/api/sites/${w.otherSite}/collections/home/entries/_/revisions`
    expect((await w.editor.get(url)).status).toBe(404)
    expect((await w.admin.get(url)).status).toBe(200)
  })

  test('restoring brings an earlier version back as a draft, byte for byte', async () => {
    const w = await world()
    const res = await w.editor.post(`${w.entry}/revisions/${w.shas.v1}/restore`)
    expect(res.json.status).toBe('modified')

    const row = w.ctx.deps.db.select().from(drafts).get()
    expect(row?.content).toBe(V1)
    expect(row?.baseSha).not.toBeNull()
    expect((await w.editor.get(w.entry)).json).toMatchObject({
      status: 'modified',
      data: { title: 'Brood', body: 'Eerste versie.\n' },
    })
    const logged = w.ctx.deps.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'content.restored'))
      .get()
    expect(logged?.details).toMatchObject({ collection: 'posts', slug: 'brood' })
  })

  test('restoring the live version simply drops the draft', async () => {
    const w = await world()
    await w.editor.put(w.entry, { data: { title: 'Concept' } })
    const res = await w.editor.post(`${w.entry}/revisions/${w.shas.v3}/restore`)
    expect(res.json.status).toBe('published')
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
  })

  test('a restored version publishes as a new commit by the editor', async () => {
    const w = await world()
    await w.editor.post(`${w.entry}/revisions/${w.shas.v2}/restore`)
    const published = await w.editor.post(`/api/sites/${w.siteId}/publish`, {})
    expect(published.status).toBe(200)
    expect(w.gh.filesAt(REPO)['src/content/posts/brood.md']).toBe(V2)

    const res = await w.editor.get(`${w.entry}/revisions`)
    expect(res.json.revisions).toHaveLength(4)
    expect(res.json.revisions[0]).toMatchObject({ authorName: 'anna' })
  })

  test('versions where the file was deleted have no data and cannot be restored', async () => {
    const w = await world()
    const files = w.gh.filesAt(REPO)
    const { 'src/content/posts/brood.md': _, ...rest } = files
    const removed = w.gh.commit(REPO, 'main', rest, { message: 'Remove bread' })
    // Make the CMS re-read the branch head, as a push webhook would.
    w.ctx.deps.db.update(sites).set({ headCheckedAt: null }).run()

    const list = await w.editor.get(`${w.entry}/revisions`)
    expect(list.json.live).toBe(false)
    expect(list.json.revisions[0].sha).toBe(removed.commitSha)
    expect((await w.editor.get(`${w.entry}/revisions/${removed.commitSha}`)).json.data).toBeNull()
    expect((await w.editor.post(`${w.entry}/revisions/${removed.commitSha}/restore`)).status).toBe(
      404,
    )
    // A deleted entry can be brought back from its history.
    const back = await w.editor.post(`${w.entry}/revisions/${w.shas.v3}/restore`)
    expect(back.json.status).toBe('new')
  })
})
