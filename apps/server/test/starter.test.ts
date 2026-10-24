import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseConfig } from '../src/content/config'
import { fakeGitHub } from './fake-github'
import { adminClient, githubFor, setup } from './helpers'

const STARTER = join(import.meta.dir, '../../../examples/astro-starter')
const SKIP = new Set(['node_modules', 'dist', '.astro'])

/** The starter's files as they'd be in a client's repository. */
function starterFiles(dir = STARTER, files: Record<string, string> = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) starterFiles(path, files)
    else files[relative(STARTER, path)] = readFileSync(path, 'utf8')
  }
  return files
}

// Keeps the example site and its .drikus/config.yml working with this CMS.
describe('examples/astro-starter', () => {
  const files = starterFiles()

  test('its config is valid', () => {
    const res = parseConfig(files['.drikus/config.yml'] as string)
    expect(res.ok ? [] : res.issues).toEqual([])
  })

  test('the CMS reads all of its content', async () => {
    const gh = fakeGitHub()
    gh.addRepo(1001, 'studioroor/bakkerij', files)
    const ctx = setup({}, githubFor(gh))
    const admin = await adminClient(ctx)
    const site = (await admin.post('/api/admin/sites', { name: 'Bakkerij', repoId: 1001 })).json
    const base = `/api/sites/${site.id}`

    const overview = await admin.get(`${base}/content`)
    expect(overview.json.status).toBe('ok')
    expect(overview.json.collections.map((c: { name: string }) => c.name)).toEqual([
      'posts',
      'home',
      'settings',
    ])

    const posts = await admin.get(`${base}/collections/posts/entries`)
    expect(
      posts.json.entries.map((e: { slug: string; title: string; invalid: boolean }) => [
        e.slug,
        e.title,
        e.invalid,
      ]),
    ).toEqual([
      ['nieuw-zuurdesembrood', 'Ons nieuwe zuurdesembrood', false],
      ['zomertaart', 'Zomertaart is terug', false],
    ])
    const post = await admin.get(`${base}/collections/posts/entries/zomertaart`)
    expect(post.json).toMatchObject({ data: { title: 'Zomertaart is terug' }, issues: [] })

    for (const name of ['home', 'settings']) {
      const single = await admin.get(`${base}/collections/${name}/entries/_`)
      expect(single.status).toBe(200)
      expect(single.json.issues).toEqual([])
    }
  })
})
