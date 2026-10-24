import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { drafts, siteMembers, sites } from '../src/db/schema'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, PASSWORD, setup } from './helpers'

const CONFIG = `
collections:
  - name: posts
    label: Nieuws
    folder: src/content/posts
    slug: "{{title}}"
    sortBy: date
    sortOrder: desc
    fields:
      - { name: title, required: true }
      - { name: date, type: date }
      - { name: body, type: markdown }
  - name: home
    file: src/content/pages/home.json
    fields:
      - { name: heading }
      - { name: sections, type: blocks, blocks: [{ name: hero, fields: [{ name: heading }] }] }
`

const OLD_POST = '---\ntitle: Oud nieuws\ndate: 2026-01-01\nlayout: Post\n---\n\nVroeger.\n'

async function world(files: Record<string, string> = {}) {
  const gh = fakeGitHub()
  gh.addRepo(1001, 'studioroor/bakkerij', {
    '.drikus/config.yml': CONFIG,
    'src/content/posts/oud-nieuws.md': OLD_POST,
    'src/content/posts/nieuw-brood.md': '---\ntitle: Nieuw brood\ndate: 2026-10-01\n---\n\nVers!\n',
    'src/content/pages/home.json': '{\n  "heading": "Welkom"\n}\n',
    ...files,
  })
  gh.addRepo(1002, 'studioroor/kapper', { '.drikus/config.yml': CONFIG })
  const ctx = setup({}, githubFor(gh))
  const admin = await adminClient(ctx)
  const bakery = (await admin.post('/api/admin/sites', { name: 'Bakkerij', repoId: 1001 })).json
    .id as string
  const barber = (await admin.post('/api/admin/sites', { name: 'Kapper', repoId: 1002 })).json
    .id as string
  const anna = await ctx.createUser({ email: 'anna@bakkerij.nl' })
  ctx.deps.db.insert(siteMembers).values({ siteId: bakery, userId: anna.id }).run()
  const editor = ctx.client()
  await editor.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
  const base = `/api/sites/${bakery}`
  return { gh, ctx, admin, editor, bakery, barber, base }
}

describe('content overview', () => {
  test('lists collections from the repository config', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.base}/content`)
    expect(res.json.status).toBe('ok')
    expect(
      res.json.collections.map((c: { name: string; kind: string }) => [c.name, c.kind]),
    ).toEqual([
      ['posts', 'folder'],
      ['home', 'file'],
    ])
  })

  test('explains missing and broken configs (details for the superadmin only)', async () => {
    const w = await world({ '.drikus/config.yml': 'collections: nope' })
    const editorView = await w.editor.get(`${w.base}/content`)
    expect(editorView.json).toMatchObject({ status: 'invalid_config', issues: null })
    const adminView = await w.admin.get(`${w.base}/content`)
    expect(adminView.json.issues.length).toBeGreaterThan(0)

    const site = (await w.admin.post('/api/admin/sites', { name: 'Leeg' })).json.id
    expect((await w.admin.get(`/api/sites/${site}/content`)).json.status).toBe('not_linked')
  })

  test('editors cannot read content of other sites', async () => {
    const w = await world()
    expect((await w.editor.get(`/api/sites/${w.barber}/content`)).status).toBe(404)
    expect((await w.editor.get(`/api/sites/${w.barber}/collections/posts/entries`)).status).toBe(
      404,
    )
    expect(
      (await w.editor.put(`/api/sites/${w.barber}/collections/posts/entries/x`, { data: {} }))
        .status,
    ).toBe(404)
  })
})

describe('entries', () => {
  test('lists entries sorted by the configured field', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.base}/collections/posts/entries`)
    expect(
      res.json.entries.map((e: { slug: string; title: string; status: string }) => [
        e.slug,
        e.title,
        e.status,
      ]),
    ).toEqual([
      ['nieuw-brood', 'Nieuw brood', 'published'],
      ['oud-nieuws', 'Oud nieuws', 'published'],
    ])
  })

  test('reads an entry with markdown body', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.base}/collections/posts/entries/oud-nieuws`)
    expect(res.json).toMatchObject({
      status: 'published',
      data: { title: 'Oud nieuws', date: '2026-01-01', layout: 'Post', body: 'Vroeger.\n' },
      draft: null,
    })
  })

  test('saving creates a draft that keeps unknown fields and overlays reads', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries/oud-nieuws`
    const save = await w.editor.put(url, {
      data: { title: 'Nieuw nieuws', date: '2026-01-01', body: 'Nu.' },
    })
    expect(save.json.status).toBe('modified')

    const row = w.ctx.deps.db.select().from(drafts).where(eq(drafts.siteId, w.bakery)).get()
    expect(row?.content).toBe(
      '---\ntitle: Nieuw nieuws\ndate: 2026-01-01\nlayout: Post\n---\n\nNu.\n',
    )
    expect(row?.baseSha).not.toBeNull()

    const read = await w.editor.get(url)
    expect(read.json).toMatchObject({ status: 'modified', data: { title: 'Nieuw nieuws' } })
    expect(read.json.draft.updatedBy.name).toBe('anna')
    const list = await w.editor.get(`${w.base}/collections/posts/entries`)
    expect(list.json.entries.find((e: { slug: string }) => e.slug === 'oud-nieuws')).toMatchObject({
      title: 'Nieuw nieuws',
      status: 'modified',
    })
    expect((await w.editor.get(`${w.base}/content`)).json.changes).toBe(1)
  })

  test('saving the published content again removes the draft', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries/oud-nieuws`
    await w.editor.put(url, { data: { title: 'Tijdelijk', date: '2026-01-01', body: 'Vroeger.' } })
    const res = await w.editor.put(url, {
      data: { title: 'Oud nieuws', date: '2026-01-01', body: 'Vroeger.' },
    })
    expect(res.json.status).toBe('published')
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
  })

  test('rejects wrong types but allows empty required fields in drafts', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries/oud-nieuws`
    const bad = await w.editor.put(url, { data: { title: 'x', date: 'gisteren' } })
    expect(bad.status).toBe(400)
    expect(bad.json).toMatchObject({
      error: 'invalid_input',
      issues: [{ path: 'date', code: 'invalid' }],
    })
    const empty = await w.editor.put(url, { data: { title: '' } })
    expect(empty.status).toBe(200)
    expect(empty.json.issues).toEqual([
      { path: 'title', code: 'required', message: 'This field is required' },
    ])
  })

  test('creates entries with unique slugs from the template', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries`
    const first = await w.editor.post(url, { data: { title: 'Nieuw brood' } })
    expect(first.json.slug).toBe('nieuw-brood-2')
    const second = await w.editor.post(url, { data: { title: 'Taart!' } })
    expect(second.json.slug).toBe('taart')
    const list = await w.editor.get(url)
    expect(list.json.entries.filter((e: { status: string }) => e.status === 'new')).toHaveLength(2)
    expect((await w.editor.post(url, { data: { title: '' } })).json.error).toBe('slug_required')
  })

  test('deleting marks published entries and drops new ones', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries`
    expect((await w.editor.del(`${url}/oud-nieuws`)).json.status).toBe('deleted')
    expect((await w.editor.get(`${url}/oud-nieuws`)).json.status).toBe('deleted')
    const created = await w.editor.post(url, { data: { title: 'Weg ermee' } })
    expect((await w.editor.del(`${url}/${created.json.slug}`)).json.status).toBe('removed')
    expect((await w.editor.get(`${url}/${created.json.slug}`)).status).toBe(404)
  })

  test('discarding restores the published version', async () => {
    const w = await world()
    const url = `${w.base}/collections/posts/entries/oud-nieuws`
    await w.editor.put(url, { data: { title: 'Anders' } })
    await w.editor.post(`${url}/discard`)
    expect((await w.editor.get(url)).json).toMatchObject({
      status: 'published',
      data: { title: 'Oud nieuws' },
    })
  })

  test('single-file collections use the configured file', async () => {
    const w = await world()
    const url = `${w.base}/collections/home/entries/_`
    expect((await w.editor.get(url)).json.data).toEqual({ heading: 'Welkom' })
    await w.editor.put(url, {
      data: { heading: 'Hallo', sections: [{ type: 'hero', heading: 'Brood' }] },
    })
    const row = w.ctx.deps.db.select().from(drafts).get()
    expect(row?.path).toBe('src/content/pages/home.json')
    expect(JSON.parse(row?.content ?? '')).toEqual({
      heading: 'Hallo',
      sections: [{ type: 'hero', heading: 'Brood' }],
    })
    expect((await w.editor.del(url)).json.error).toBe('cannot_delete')
  })

  test('slugs cannot escape the collection folder', async () => {
    const w = await world()
    for (const slug of ['..%2F..%2F.github%2Fworkflows%2Fci', '.drikus', 'a.b', '%2E%2E']) {
      const res = await w.editor.put(`${w.base}/collections/posts/entries/${slug}`, {
        data: { title: 'x' },
      })
      expect(res.status).toBe(404)
    }
    expect((await w.editor.get(`${w.base}/collections/nope/entries`)).status).toBe(404)
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
  })

  test('lists pending changes', async () => {
    const w = await world()
    await w.editor.put(`${w.base}/collections/posts/entries/oud-nieuws`, { data: { title: 'A' } })
    await w.editor.post(`${w.base}/collections/posts/entries`, { data: { title: 'B' } })
    const res = await w.editor.get(`${w.base}/changes`)
    expect(
      res.json.changes.map((c: { slug: string; status: string }) => [c.slug, c.status]).sort(),
    ).toEqual([
      ['b', 'new'],
      ['oud-nieuws', 'modified'],
    ])
  })

  test('linking the site to another repository clears its drafts', async () => {
    const w = await world()
    await w.editor.put(`${w.base}/collections/posts/entries/oud-nieuws`, { data: { title: 'A' } })
    await w.admin.patch(`/api/admin/sites/${w.bakery}`, { repoId: null })
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
    expect(
      w.ctx.deps.db.select().from(sites).where(eq(sites.id, w.bakery)).get()?.repoId,
    ).toBeNull()
  })
})

describe('yaml folder collections', () => {
  test('new entries never clash with existing .yml files', async () => {
    const gh = fakeGitHub()
    gh.addRepo(1001, 'studioroor/team', {
      '.drikus/config.yml':
        'collections: [{ name: team, folder: data/team, format: yaml, slug: "{{name}}", fields: [{ name: name }] }]',
      'data/team/anna.yml': 'name: Anna\n',
    })
    const ctx = setup({}, githubFor(gh))
    const admin = await adminClient(ctx)
    const site = (await admin.post('/api/admin/sites', { name: 'Team', repoId: 1001 })).json.id
    const base = `/api/sites/${site}/collections/team/entries`
    expect((await admin.get(`${base}/anna`)).json.data).toEqual({ name: 'Anna' })
    expect((await admin.post(base, { data: { name: 'Anna' } })).json.slug).toBe('anna-2')
    await admin.put(`${base}/anna`, { data: { name: 'Anna B' } })
    expect(
      ctx.deps.db
        .select()
        .from(drafts)
        .all()
        .map((d) => d.path)
        .sort(),
    ).toEqual(['data/team/anna-2.yaml', 'data/team/anna.yml'])
  })
})
