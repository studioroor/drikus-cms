import { describe, expect, test } from 'bun:test'
import { findSiteIcon } from '../src/content/icon'
import type { TreeEntry } from '../src/db/schema'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, setup } from './helpers'

const blobs = (...paths: string[]): TreeEntry[] =>
  paths.map((path) => ({ path, type: 'blob', sha: path, size: 100 }))

describe('findSiteIcon', () => {
  test('prefers a favicon.svg over other icons', () => {
    const icon = findSiteIcon(
      blobs('logo.png', 'public/favicon.ico', 'public/favicon.svg', 'public/apple-touch-icon.png'),
    )
    expect(icon?.path).toBe('public/favicon.svg')
  })

  test('prefers public folders, then shallower paths', () => {
    expect(findSiteIcon(blobs('docs/x/favicon.svg', 'apps/web/public/favicon.svg'))?.path).toBe(
      'apps/web/public/favicon.svg',
    )
    expect(findSiteIcon(blobs('a/b/favicon.svg', 'a/favicon.svg'))?.path).toBe('a/favicon.svg')
  })

  test('finds Next.js app icons and logos', () => {
    expect(findSiteIcon(blobs('src/app/icon.png', 'README.md'))?.path).toBe('src/app/icon.png')
    expect(findSiteIcon(blobs('src/assets/Logo.svg'))?.path).toBe('src/assets/Logo.svg')
  })

  test('ignores dependencies, build output, folders and huge files', () => {
    const entries: TreeEntry[] = [
      ...blobs('node_modules/pkg/favicon.svg', 'dist/favicon.svg'),
      { path: 'public/favicon.svg', type: 'tree', sha: 't' },
      { path: 'static/favicon.png', type: 'blob', sha: 'big', size: 10 * 1024 * 1024 },
    ]
    expect(findSiteIcon(entries)).toBeNull()
  })

  test('returns null when nothing looks like an icon', () => {
    expect(findSiteIcon(blobs('README.md', 'public/hero.jpg', 'src/logo.tsx'))).toBeNull()
  })
})

describe('site icon API', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>'

  async function world(files: Record<string, string>) {
    const gh = fakeGitHub()
    gh.addRepo(1001, 'studioroor/bakkerij', files)
    const ctx = setup({}, githubFor(gh))
    const admin = await adminClient(ctx)
    const id = (await admin.post('/api/admin/sites', { name: 'Bakkerij', repoId: 1001 })).json
      .id as string
    const get = (path: string, headers: Record<string, string> = {}) =>
      ctx.app.request(path, { headers: { cookie: admin.cookie, ...headers } })
    return { ctx, admin, get, path: `/api/sites/${id}/icon` }
  }

  test('serves the icon found in the repo, with an ETag', async () => {
    const w = await world({ 'public/favicon.svg': SVG, 'README.md': '# hi' })
    const res = await w.get(w.path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(await res.text()).toBe(SVG)

    const again = await w.get(w.path, { 'if-none-match': res.headers.get('etag') as string })
    expect(again.status).toBe(304)
  })

  test('uses the icon named in the config', async () => {
    const w = await world({
      '.drikus/config.yml':
        'icon: brand/mark.png\ncollections:\n  - { name: home, file: home.json, fields: [{ name: title }] }\n',
      'public/favicon.svg': SVG,
      'brand/mark.png': 'PNG',
    })
    const res = await w.get(w.path)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(await res.text()).toBe('PNG')
  })

  test('404s without an icon or a linked repo; 401s when signed out', async () => {
    const w = await world({ 'README.md': '# hi' })
    expect((await w.get(w.path)).status).toBe(404)
    const unlinked = w.ctx.createSite('Los')
    expect((await w.get(`/api/sites/${unlinked.id}/icon`)).status).toBe(404)
    expect((await w.ctx.client().get(w.path)).status).toBe(401)
  })
})
