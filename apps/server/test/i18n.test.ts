import { describe, expect, test } from 'bun:test'
import { parseConfig } from '../src/content/config'
import { entryForPath, entryPathFor } from '../src/content/paths'
import { drafts, siteMembers } from '../src/db/schema'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, PASSWORD, setup } from './helpers'

const CONFIG = `
i18n: { locales: [nl, en] }
collections:
  - name: posts
    folder: src/content/posts/{{locale}}
    sortBy: date
    fields:
      - { name: title, required: true }
      - { name: date, type: date, required: true, i18n: false }
      - { name: cover, type: image, i18n: false }
      - { name: body, type: markdown }
  - name: team
    folder: data/team
    format: yaml
    slug: "{{name}}"
    i18n: true
    fields:
      - { name: name, i18n: false }
      - { name: role }
  - name: home
    file: src/content/pages/home.json
    i18n: true
    fields:
      - { name: heading, required: true }
      - { name: phone, i18n: false }
  - name: about
    file: src/content/{{locale}}/about.md
    fields: [{ name: title }, { name: body, type: markdown }]
`

function config() {
  const res = parseConfig(CONFIG)
  if (!res.ok) throw new Error(JSON.stringify(res.issues))
  return res.config
}

describe('config', () => {
  test('works out how each collection stores languages', () => {
    expect(config().collections.map((c) => [c.name, c.translation])).toEqual([
      ['posts', 'files'],
      ['team', 'suffix'],
      ['home', 'sections'],
      ['about', 'files'],
    ])
  })

  test.each([
    [
      'collections: [{ name: p, folder: "x/{{locale}}", fields: [{ name: t }] }]',
      'need the site languages',
    ],
    [
      'i18n: { locales: [nl, en] }\ncollections: [{ name: p, file: x.md, i18n: true, fields: [{ name: t }] }]',
      'Markdown file holds one language',
    ],
    [
      'i18n: { locales: [nl, en], default: fr }\ncollections: [{ name: p, folder: x, fields: [{ name: t }] }]',
      'not one of the languages',
    ],
    [
      'i18n: { locales: [nl, en] }\ncollections: [{ name: p, folder: "../{{locale}}", fields: [{ name: t }] }]',
      '..',
    ],
    [
      'i18n: { locales: [nl, en] }\ncollections: [{ name: p, folder: "x/{{locale}}", i18n: false, fields: [{ name: t }] }]',
      'Remove {{locale}}',
    ],
  ])('rejects %p', (source, message) => {
    const res = parseConfig(source)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.map((i) => i.message).join(' ')).toContain(message)
  })
})

describe('paths', () => {
  const [posts, team, home, about] = config().collections as [never, never, never, never]
  const none = new Set<string>()

  test('maps entries and languages to files', () => {
    expect(entryPathFor(posts, 'brood', none, 'en')).toBe('src/content/posts/en/brood.md')
    expect(entryPathFor(team, 'anna', none, 'nl')).toBe('data/team/anna.nl.yaml')
    expect(entryPathFor(team, 'anna', new Set(['data/team/anna.nl.yml']), 'nl')).toBe(
      'data/team/anna.nl.yml',
    )
    expect(entryPathFor(home, '_', none, 'en')).toBe('src/content/pages/home.json')
    expect(entryPathFor(about, '_', none, 'en')).toBe('src/content/en/about.md')
    expect(entryPathFor(posts, 'brood', none)).toBeNull()
    expect(entryPathFor(posts, '../x', none, 'en')).toBeNull()
  })

  test('maps files back to entries and languages', () => {
    expect(entryForPath(posts, 'src/content/posts/en/brood.md', ['nl', 'en'])).toEqual({
      slug: 'brood',
      locale: 'en',
    })
    expect(entryForPath(posts, 'src/content/posts/fr/brood.md', ['nl', 'en'])).toBeNull()
    expect(entryForPath(team, 'data/team/anna.en.yaml', ['nl', 'en'])).toEqual({
      slug: 'anna',
      locale: 'en',
    })
    expect(entryForPath(team, 'data/team/anna.yaml', ['nl', 'en'])).toBeNull()
    expect(entryForPath(team, 'data/team/anna.fr.yaml', ['nl', 'en'])).toBeNull()
  })
})

const REPO = 1001

async function world() {
  const gh = fakeGitHub()
  gh.addRepo(REPO, 'studioroor/bakkerij', {
    '.drikus/config.yml': CONFIG,
    'src/content/posts/nl/brood.md': '---\ntitle: Brood\ndate: 2026-01-01\n---\n\nVers brood.\n',
    'src/content/posts/en/brood.md': '---\ntitle: Bread\ndate: 2026-01-01\n---\n\nFresh bread.\n',
    'src/content/posts/nl/taart.md':
      '---\ntitle: Taart\ndate: 2026-02-01\ncover: /uploads/taart.webp\n---\n',
    'data/team/anna.nl.yaml': 'name: Anna\nrole: Bakker\n',
    'data/team/anna.en.yaml': 'name: Anna\nrole: Baker\n',
    'src/content/pages/home.json': JSON.stringify(
      { nl: { heading: 'Welkom', phone: '010-1' }, en: { heading: 'Welcome', phone: '010-1' } },
      null,
      2,
    ),
    'src/content/nl/about.md': '---\ntitle: Over ons\n---\n\nWij bakken.\n',
  })
  const ctx = setup({}, githubFor(gh))
  const admin = await adminClient(ctx)
  const siteId = (await admin.post('/api/admin/sites', { name: 'Bakkerij', repoId: REPO })).json
    .id as string
  const anna = await ctx.createUser({ email: 'anna@bakkerij.nl' })
  ctx.deps.db.insert(siteMembers).values({ siteId, userId: anna.id }).run()
  const editor = ctx.client()
  await editor.post('/api/auth/login', { email: 'anna@bakkerij.nl', password: PASSWORD })
  const base = `/api/sites/${siteId}`
  const entry = (collection: string, slug: string, locale?: string) =>
    `${base}/collections/${collection}/entries/${slug}${locale ? `?locale=${locale}` : ''}`
  const draftAt = (path: string) =>
    ctx.deps.db
      .select()
      .from(drafts)
      .all()
      .find((d) => d.path === path)
  return { gh, ctx, editor, base, entry, draftAt }
}

describe('translated content', () => {
  test('the overview lists the languages and translated collections', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.base}/content`)
    expect(res.json.i18n).toEqual({ locales: ['nl', 'en'], main: 'nl' })
    expect(
      res.json.collections.map((c: { name: string; translated: boolean }) => c.translated),
    ).toEqual([true, true, true, true])
  })

  test('lists entries once, with the status of each language', async () => {
    const w = await world()
    const res = await w.editor.get(`${w.base}/collections/posts/entries`)
    expect(
      res.json.entries.map((e: { slug: string; title: string; locales: unknown }) => [
        e.slug,
        e.title,
        e.locales,
      ]),
    ).toEqual([
      [
        'brood',
        'Brood',
        [
          { code: 'nl', status: 'published' },
          { code: 'en', status: 'published' },
        ],
      ],
      [
        'taart',
        'Taart',
        [
          { code: 'nl', status: 'published' },
          { code: 'en', status: 'missing' },
        ],
      ],
    ])
  })

  test('reads each language, and starts a missing translation with the shared fields', async () => {
    const w = await world()
    expect((await w.editor.get(w.entry('posts', 'brood'))).json).toMatchObject({
      locale: 'nl',
      data: { title: 'Brood' },
    })
    expect((await w.editor.get(w.entry('posts', 'brood', 'en'))).json).toMatchObject({
      locale: 'en',
      status: 'published',
      data: { title: 'Bread' },
    })
    const missing = await w.editor.get(w.entry('posts', 'taart', 'en'))
    expect(missing.json).toMatchObject({
      status: 'missing',
      data: { date: '2026-02-01', cover: '/uploads/taart.webp' },
      locales: [
        { code: 'nl', status: 'published' },
        { code: 'en', status: 'missing' },
      ],
    })
    expect(missing.json.data.title).toBeUndefined()
    expect((await w.editor.get(w.entry('posts', 'brood', 'fr'))).status).toBe(404)
  })

  test('saving a translation creates its file', async () => {
    const w = await world()
    const res = await w.editor.put(w.entry('posts', 'taart', 'en'), {
      data: { title: 'Cake', date: '2026-02-01', cover: '/uploads/taart.webp' },
    })
    expect(res.json.status).toBe('new')
    expect(w.draftAt('src/content/posts/en/taart.md')).toMatchObject({
      locale: 'en',
      slug: 'taart',
    })
    const list = await w.editor.get(`${w.base}/collections/posts/entries`)
    expect(list.json.entries.find((e: { slug: string }) => e.slug === 'taart').locales).toEqual([
      { code: 'nl', status: 'published' },
      { code: 'en', status: 'new' },
    ])
  })

  test('shared fields are kept the same in every language', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'brood', 'nl'), {
      data: { title: 'Brood', date: '2026-03-03', body: 'Vers brood.' },
    })
    expect(w.draftAt('src/content/posts/en/brood.md')?.content).toBe(
      '---\ntitle: Bread\ndate: 2026-03-03\n---\n\nFresh bread.\n',
    )
    expect((await w.editor.get(w.entry('posts', 'brood', 'en'))).json).toMatchObject({
      status: 'modified',
      data: { title: 'Bread', date: '2026-03-03' },
    })
    // Changing it back makes both languages unchanged again.
    await w.editor.put(w.entry('posts', 'brood', 'en'), {
      data: { title: 'Bread', date: '2026-01-01', body: 'Fresh bread.' },
    })
    await w.editor.put(w.entry('posts', 'brood', 'nl'), {
      data: { title: 'Brood', date: '2026-01-01', body: 'Vers brood.' },
    })
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
  })

  test('language in the file name', async () => {
    const w = await world()
    expect((await w.editor.get(w.entry('team', 'anna', 'en'))).json.data).toEqual({
      name: 'Anna',
      role: 'Baker',
    })
    await w.editor.put(w.entry('team', 'anna', 'en'), {
      data: { name: 'Anna', role: 'Head baker' },
    })
    expect(w.draftAt('data/team/anna.en.yaml')?.content).toBe('name: Anna\nrole: Head baker\n')
    const created = await w.editor.post(`${w.base}/collections/team/entries?locale=en`, {
      data: { name: 'Piet', role: 'Driver' },
    })
    expect(created.json.slug).toBe('piet')
    expect(w.draftAt('data/team/piet.en.yaml')).toMatchObject({ locale: 'en' })
  })

  test('all languages in one data file', async () => {
    const w = await world()
    const en = await w.editor.get(w.entry('home', '_', 'en'))
    expect(en.json).toMatchObject({
      data: { heading: 'Welcome', phone: '010-1' },
      status: 'published',
    })
    await w.editor.put(w.entry('home', '_', 'en'), { data: { heading: 'Hello', phone: '010-2' } })
    const row = w.draftAt('src/content/pages/home.json')
    expect(row?.locale).toBeNull()
    expect(JSON.parse(row?.content ?? '')).toEqual({
      nl: { heading: 'Welkom', phone: '010-2' },
      en: { heading: 'Hello', phone: '010-2' },
    })
    expect((await w.editor.get(w.entry('home', '_', 'nl'))).json.locales).toEqual([
      { code: 'nl', status: 'modified' },
      { code: 'en', status: 'modified' },
    ])
  })

  test('a single page with a file per language', async () => {
    const w = await world()
    expect((await w.editor.get(w.entry('about', '_', 'en'))).json).toMatchObject({
      status: 'missing',
      data: {},
    })
    await w.editor.put(w.entry('about', '_', 'en'), {
      data: { title: 'About us', body: 'We bake.' },
    })
    expect(w.draftAt('src/content/en/about.md')?.content).toBe(
      '---\ntitle: About us\n---\n\nWe bake.\n',
    )
  })

  test('new entries get a slug that is free in every language', async () => {
    const w = await world()
    const res = await w.editor.post(`${w.base}/collections/posts/entries?locale=en`, {
      data: { title: 'Brood', date: '2026-04-01' },
    })
    expect(res.json.slug).toBe('brood-2')
    expect(w.draftAt('src/content/posts/en/brood-2.md')).toBeDefined()
  })

  test('deleting and discarding cover every language', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'brood', 'en'), {
      data: { title: 'Loaf', date: '2026-01-01' },
    })
    await w.editor.post(`${w.entry('posts', 'brood')}/discard`)
    expect(w.ctx.deps.db.select().from(drafts).all()).toHaveLength(0)
    await w.editor.del(w.entry('posts', 'brood'))
    expect(
      w.ctx.deps.db
        .select()
        .from(drafts)
        .all()
        .map((d) => [d.path, d.action])
        .sort(),
    ).toEqual([
      ['src/content/posts/en/brood.md', 'delete'],
      ['src/content/posts/nl/brood.md', 'delete'],
    ])
  })

  test('publishing checks each language and writes every file', async () => {
    const w = await world()
    await w.editor.put(w.entry('posts', 'taart', 'en'), { data: { date: '2026-02-01' } })
    await w.editor.put(w.entry('home', '_', 'en'), { data: { heading: '', phone: '010-1' } })
    const preview = await w.editor.get(`${w.base}/publish`)
    expect(
      preview.json.problems
        .map((p: { kind: string; slug: string; locale: string; fields: string[] }) => [
          p.kind,
          p.slug,
          p.locale,
          p.fields,
        ])
        .sort(),
    ).toEqual([
      ['required', '_', 'en', ['heading']],
      ['required', 'taart', 'en', ['title']],
    ])
    await w.editor.put(w.entry('posts', 'taart', 'en'), {
      data: { title: 'Cake', date: '2026-02-01' },
    })
    await w.editor.put(w.entry('home', '_', 'en'), { data: { heading: 'Hello', phone: '010-1' } })
    expect((await w.editor.post(`${w.base}/publish`, {})).status).toBe(200)
    const files = w.gh.filesAt(REPO)
    expect(files['src/content/posts/en/taart.md']).toContain('title: Cake')
    expect(JSON.parse(files['src/content/pages/home.json'] ?? '')).toEqual({
      nl: { heading: 'Welkom', phone: '010-1' },
      en: { heading: 'Hello', phone: '010-1' },
    })
  })
})
