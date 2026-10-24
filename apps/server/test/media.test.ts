import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { parseConfig } from '../src/content/config'
import { mediaSettings, processUpload, sniff } from '../src/content/media'
import { siteMembers, stagedMedia } from '../src/db/schema'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, ORIGIN, PASSWORD, setup } from './helpers'

const CONFIG = `
media: { maxWidth: 800 }
collections:
  - name: home
    file: src/content/pages/home.json
    fields: [{ name: heading }, { name: hero, type: image }]
`

const settings = mediaSettings({ collections: [] })

async function photo(width = 1600, height = 1200, format: 'png' | 'jpeg' = 'png') {
  const img = sharp({ create: { width, height, channels: 3, background: '#c86432' } })
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer()
}

describe('settings', () => {
  test('defaults to public/uploads served at /uploads', () => {
    expect(settings).toMatchObject({
      folder: 'public/uploads',
      publicPath: '/uploads',
      maxWidth: 2000,
      format: 'webp',
    })
    const res = parseConfig(
      'media: { folder: static/img }\ncollections: [{ name: a, folder: x, fields: [{ name: t }] }]',
    )
    if (!res.ok) throw new Error('config')
    expect(mediaSettings(res.config)).toMatchObject({
      folder: 'static/img',
      publicPath: '/static/img',
    })
  })

  test('rejects unsafe media folders', () => {
    for (const folder of ['.github/x', '../up', '/abs']) {
      expect(
        parseConfig(
          `media: { folder: "${folder}" }\ncollections: [{ name: a, folder: x, fields: [{ name: t }] }]`,
        ).ok,
      ).toBe(false)
    }
  })
})

describe('sniffing', () => {
  test('detects types from bytes, not names', async () => {
    expect(sniff(await photo(10, 10), 'foto.jpg')).toMatchObject({ ext: 'png', kind: 'image' })
    expect(sniff(Buffer.from('%PDF-1.7 ...'), 'menu.pdf')).toMatchObject({
      ext: 'pdf',
      kind: 'file',
    })
    expect(sniff(Buffer.from('a,b\n1,2\n'), 'prijzen.csv')).toMatchObject({ ext: 'csv' })
  })

  test('refuses SVG, HTML, scripts and unknown binaries', () => {
    expect(
      sniff(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        'x.svg',
      ),
    ).toBeNull()
    expect(sniff(Buffer.from('<!doctype html><script>alert(1)</script>'), 'x.png')).toBeNull()
    expect(sniff(Buffer.from('MZ\x90\x00'), 'setup.exe')).toBeNull()
    expect(sniff(Buffer.from('hello\x00world'), 'x.txt')).toBeNull()
  })
})

describe('processing', () => {
  test('scales down and converts to WebP with a content-hashed name', async () => {
    const out = await processUpload(await photo(), 'Mijn Taart!.png', {
      ...settings,
      maxWidth: 800,
    })
    expect(out.name).toMatch(/^mijn-taart-[0-9a-f]{8}\.webp$/)
    expect(out).toMatchObject({ kind: 'image', width: 800, height: 600 })
    expect((await sharp(out.bytes).metadata()).format).toBe('webp')
    const again = await processUpload(await photo(), 'Mijn Taart!.png', {
      ...settings,
      maxWidth: 800,
    })
    expect(again.name).toBe(out.name)
  })

  test('strips metadata such as GPS location', async () => {
    const withExif = await sharp(await photo(400, 300, 'jpeg'))
      .withExif({
        IFD0: { Copyright: 'secret', Make: 'Phone' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 0/1 0/1' },
      })
      .jpeg()
      .toBuffer()
    expect((await sharp(withExif).metadata()).exif).toBeDefined()
    const out = await processUpload(withExif, 'vakantie.jpg', settings)
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined()
    const kept = await processUpload(withExif, 'vakantie.jpg', { ...settings, format: 'original' })
    expect(kept.name).toEndWith('.jpg')
    expect((await sharp(kept.bytes).metadata()).exif).toBeUndefined()
  })

  test('keeps files as they are and enforces limits', async () => {
    const pdf = Buffer.from('%PDF-1.7\nhello')
    const out = await processUpload(pdf, 'Menukaart 2026.pdf', settings)
    expect(out).toMatchObject({ kind: 'file', bytes: pdf })
    expect(out.name).toMatch(/^menukaart-2026-[0-9a-f]{8}\.pdf$/)
    await expect(processUpload(pdf, 'x.pdf', { ...settings, maxBytes: 4 })).rejects.toMatchObject({
      code: 'file_too_large',
    })
    await expect(processUpload(Buffer.from('<svg/>'), 'x.svg', settings)).rejects.toMatchObject({
      code: 'unsupported_file',
    })
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)])
    await expect(processUpload(broken, 'kapot.jpg', settings)).rejects.toMatchObject({
      code: 'invalid_image',
    })
  })
})

const REPO = 1001

async function world(config = CONFIG, extra: Record<string, string | Buffer> = {}) {
  const gh = fakeGitHub()
  gh.addRepo(REPO, 'studioroor/bakkerij', {
    '.drikus/config.yml': config,
    'src/content/pages/home.json': '{\n  "heading": "Welkom"\n}\n',
    '.github/workflows/deploy.yml': 'on: push\n',
    ...extra,
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

  const upload = async (bytes: Buffer, name: string, site = siteId) => {
    const form = new FormData()
    form.append('file', new File([bytes], name))
    const res = await ctx.app.request(`/api/sites/${site}/media`, {
      method: 'POST',
      headers: { cookie: editor.cookie, 'x-drikus-csrf': '1', origin: ORIGIN },
      body: form,
    })
    // biome-ignore lint/suspicious/noExplicitAny: tests assert on loosely typed JSON bodies
    return { status: res.status, json: (await res.json()) as Record<string, any> }
  }
  const file = (src: string, extra = '') =>
    ctx.app.request(`/api/sites/${siteId}/media/file?src=${encodeURIComponent(src)}${extra}`, {
      headers: { cookie: editor.cookie },
    })
  return { gh, ctx, admin, editor, siteId, otherSite, base: `/api/sites/${siteId}`, upload, file }
}

describe('media API', () => {
  test('uploads are staged, previewable, and counted as changes', async () => {
    const w = await world()
    const res = await w.upload(await photo(), 'Taart.png')
    expect(res.status).toBe(200)
    expect(res.json.item).toMatchObject({ status: 'new', kind: 'image' })
    expect(res.json.item.src).toMatch(/^\/uploads\/taart-[0-9a-f]{8}\.webp$/)
    expect(res.json.item.path).toBe(`public${res.json.item.src}`)

    const list = await w.editor.get(`${w.base}/media`)
    expect(list.json.items.map((i: { src: string; status: string }) => [i.src, i.status])).toEqual([
      [res.json.item.src, 'new'],
    ])

    const full = await w.file(res.json.item.src)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('image/webp')
    expect(full.headers.get('content-security-policy')).toContain('sandbox')
    expect((await sharp(Buffer.from(await full.arrayBuffer())).metadata()).width).toBe(800)
    const thumb = await w.file(`${res.json.item.src}#right`, '&w=160')
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(160)

    // Plain URLs are cached briefly; URLs with the file's version are cached for good.
    expect(full.headers.get('cache-control')).toContain('stale-while-revalidate')
    const version = list.json.items[0].version
    expect(version).toMatch(/^[0-9a-f]{40}$/)
    expect(res.json.item.version).toBe(version)
    const pinned = await w.file(res.json.item.src, `&w=160&v=${version}`)
    expect(pinned.headers.get('cache-control')).toContain('immutable')
    expect((await w.file(res.json.item.src, '&v=0000')).headers.get('cache-control')).not.toContain(
      'immutable',
    )
    const revalidated = await w.ctx.app.request(
      `${w.base}/media/file?src=${encodeURIComponent(res.json.item.src)}&w=160`,
      {
        headers: { cookie: w.editor.cookie, 'if-none-match': thumb.headers.get('etag') as string },
      },
    )
    expect(revalidated.status).toBe(304)

    expect((await w.editor.get(`${w.base}/content`)).json.changes).toBe(1)
    const changes = await w.editor.get(`${w.base}/changes`)
    expect(changes.json.changes[0]).toMatchObject({
      collection: '@media',
      status: 'new',
      updatedBy: { name: 'anna' },
    })
  })

  test('the same file uploaded twice is stored once', async () => {
    const w = await world()
    const a = await w.upload(await photo(), 'taart.png')
    const b = await w.upload(await photo(), 'taart.png')
    expect(b.json.item.src).toBe(a.json.item.src)
    expect(w.ctx.deps.db.select().from(stagedMedia).all()).toHaveLength(1)
  })

  test('publishing commits uploads as blobs together with drafts', async () => {
    const w = await world()
    const up = await w.upload(await photo(), 'taart.png')
    await w.editor.put(`${w.base}/collections/home/entries/_`, {
      data: { heading: 'Welkom', hero: up.json.item.src },
    })
    const preview = await w.editor.get(`${w.base}/publish`)
    expect(preview.json.changes.map((c: { collection: string }) => c.collection).sort()).toEqual([
      '@media',
      'home',
    ])

    const res = await w.editor.post(`${w.base}/publish`, {})
    expect(res.status).toBe(200)
    const committed = w.gh.binaryAt(REPO)[up.json.item.path]
    expect(committed).toBeDefined()
    expect((await sharp(committed as Buffer).metadata()).format).toBe('webp')
    expect(w.gh.filesAt(REPO)['src/content/pages/home.json']).toContain(up.json.item.src)
    expect(w.gh.state.commits.get(res.json.publish.commitSha)?.message).toContain(
      `- new ${up.json.item.path}`,
    )

    expect(w.ctx.deps.db.select().from(stagedMedia).all()).toHaveLength(0)
    const list = await w.editor.get(`${w.base}/media`)
    expect(list.json.items[0]).toMatchObject({
      src: up.json.item.src,
      status: 'published',
      // Same bytes, same version: cached previews stay valid after publishing.
      version: up.json.item.version,
    })
    // Still previewable, now from GitHub.
    expect((await w.file(up.json.item.src)).status).toBe(200)
    // Uploading it again is a no-op.
    const again = await w.upload(await photo(), 'taart.png')
    expect(again.json.item.status).toBe('published')
    expect(w.ctx.deps.db.select().from(stagedMedia).all()).toHaveLength(0)
  })

  test('only unpublished uploads can be removed', async () => {
    const w = await world()
    const up = await w.upload(await photo(), 'taart.png')
    expect(
      (await w.editor.del(`${w.base}/media?src=${encodeURIComponent(up.json.item.src)}`)).status,
    ).toBe(200)
    expect(w.ctx.deps.db.select().from(stagedMedia).all()).toHaveLength(0)
    expect(
      (await w.editor.del(`${w.base}/media?src=${encodeURIComponent('/uploads/nope.webp')}`)).json
        .error,
    ).toBe('cannot_delete')
  })

  test('refuses unsupported files', async () => {
    const w = await world()
    const res = await w.upload(Buffer.from('<svg onload="alert(1)"/>'), 'logo.svg')
    expect(res).toMatchObject({ status: 400, json: { error: 'unsupported_file' } })
  })

  test('only serves media files, never other repo files', async () => {
    const w = await world()
    for (const src of [
      '/uploads/../../.github/workflows/deploy.yml',
      '/../.drikus/config.yml',
      '/../src/content/pages/home.json',
      '/.github/workflows/deploy.yml',
    ]) {
      expect((await w.file(src)).status).toBe(404)
    }
  })

  test('sends images that are not in the repo to the live site, cacheably', async () => {
    const w = await world()
    await w.admin.patch(`/api/admin/sites/${w.siteId}`, { siteUrl: 'https://bakkerij.nl/' })
    const res = await w.file('/images/winkel.jpg', '&w=800')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://bakkerij.nl/images/winkel.jpg')
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })

  test('editors cannot upload to or read media of other sites', async () => {
    const w = await world()
    expect((await w.upload(await photo(), 'x.png', w.otherSite)).status).toBe(404)
    expect((await w.editor.get(`/api/sites/${w.otherSite}/media`)).status).toBe(404)
  })

  test('linking another repository drops pending uploads', async () => {
    const w = await world()
    await w.upload(await photo(), 'taart.png')
    await w.admin.patch(`/api/admin/sites/${w.siteId}`, { repoId: null })
    expect(w.ctx.deps.db.select().from(stagedMedia).all()).toHaveLength(0)
  })
})

describe('media usage', () => {
  const USAGE_CONFIG = `${CONFIG.replace('collections:\n', 'collections:\n  - name: posts\n    folder: src/content/posts\n    fields: [{ name: title }, { name: body, type: markdown }]\n')}`

  test('marks library files that no content references yet', async () => {
    const w = await world(USAGE_CONFIG, {
      'src/content/posts/taart.md': '---\ntitle: Taart\n---\n\n![](/uploads/a.webp#right)\n',
      'public/uploads/a.webp': await photo(10, 10),
      'public/uploads/b.webp': await photo(12, 12),
      // Not entries: a co-located image and files nested deeper or with another extension.
      'src/content/posts/taart.webp': await photo(8, 8),
      'src/content/posts/notes.txt': 'see /uploads/b.webp',
      'src/content/posts/old/taart.md': '![](/uploads/b.webp)',
    })
    const used = async () => {
      const res = await w.editor.get(`${w.base}/media`)
      expect(res.json.complete).toBe(true)
      return Object.fromEntries(
        res.json.items.map((i: { name: string; used: boolean }) => [i.name, i.used]),
      )
    }
    expect(await used()).toEqual({ 'a.webp': true, 'b.webp': false })

    await w.editor.put(`${w.base}/collections/posts/entries/taart`, {
      data: { title: 'Nieuw', body: '![](/uploads/b.webp)' },
    })
    expect(await used()).toEqual({ 'a.webp': true, 'b.webp': true })

    await w.editor.post(`${w.base}/collections/posts/entries/taart/discard`)
    expect(await used()).toEqual({ 'a.webp': true, 'b.webp': false })

    const staged = await w.upload(await photo(), 'Vers.png')
    const fresh = (await w.editor.get(`${w.base}/media`)).json.items.find(
      (i: { src: string }) => i.src === staged.json.item.src,
    )
    expect(fresh.used).toBe(false)
  })
})
