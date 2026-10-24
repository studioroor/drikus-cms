import { describe, expect, test } from 'bun:test'
import { configJsonSchema, parseConfig } from '../src/content/config'
import { checkFields, entryTitle } from '../src/content/fields'
import { parseDocument, serializeDocument } from '../src/content/format'
import { entryPathFor, renderSlug, slugForPath, slugify } from '../src/content/paths'

const VALID = `
collections:
  - name: posts
    label: { nl: Nieuws, en: News }
    folder: src/content/posts
    sortBy: date
    sortOrder: desc
    fields:
      - { name: title, required: true }
      - { name: date, type: date }
      - { name: body, type: richtext }
  - name: home
    file: src/content/pages/home.json
    fields:
      - name: sections
        type: blocks
        blocks:
          - { name: hero, fields: [{ name: heading }] }
          - name: faq
            fields:
              - name: items
                type: list
                fields: [{ name: q }, { name: a, type: text }]
      - { name: featured, type: reference, collection: posts }
`

describe('parseConfig', () => {
  test('parses a valid config and infers formats', () => {
    const res = parseConfig(VALID)
    if (!res.ok) throw new Error(JSON.stringify(res.issues))
    expect(res.config.collections.map((c) => [c.name, c.format])).toEqual([
      ['posts', 'md'],
      ['home', 'json'],
    ])
    expect(res.config.collections[0]?.fields[0]?.type).toBe('string')
  })

  test.each([
    ['../outside', 'No empty, . or .. segments'],
    ['/etc', 'No leading or trailing slash'],
    ['.github/workflows', 'not allowed'],
    ['.drikus', 'not allowed'],
    ['src/../../x', '..'],
    ['src\\posts', 'Only letters'],
  ])('rejects unsafe folder %p', (folder, message) => {
    const res = parseConfig(
      `collections: [{ name: x, folder: "${folder.replace(/\\/g, '\\\\')}", fields: [{ name: title }] }]`,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.map((i) => i.message).join(' ')).toContain(message)
  })

  test('reports semantic problems', () => {
    const res = parseConfig(`
collections:
  - name: a
    folder: x
    summary: nope
    fields: [{ name: t }, { name: t }, { name: s, type: select }, { name: r, type: reference, collection: b }]
  - name: b
    file: x.txt
    fields: [{ name: l, type: list }]
`)
    expect(res.ok).toBe(false)
    if (res.ok) return
    const messages = res.issues.map((i) => i.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'Duplicate field name "t"',
        'A select field needs options',
        'Unknown field "nope"',
        'Collection "b" is not a folder collection',
        'Use a .md, .mdx, .json, .yaml or .yml file',
        'A list field needs either "fields" (list of objects) or "field" (list of values)',
      ]),
    )
  })

  test('reports syntax errors instead of throwing', () => {
    const res = parseConfig('collections: [unclosed')
    expect(res.ok).toBe(false)
  })

  test('exports a JSON schema', () => {
    const schema = configJsonSchema() as { properties: Record<string, unknown> }
    expect(schema.properties.collections).toBeDefined()
  })
})

describe('documents', () => {
  test('markdown keeps unknown frontmatter and the body', () => {
    const source =
      '---\ntitle: Hallo\nlayout: ../layouts/Post.astro\ntags:\n  - brood\n---\n\n# Kop\n\nTekst\n'
    const data = parseDocument('md', source)
    expect(data).toEqual({
      title: 'Hallo',
      layout: '../layouts/Post.astro',
      tags: ['brood'],
      body: '# Kop\n\nTekst\n',
    })
    expect(serializeDocument('md', data)).toBe(source)
  })

  test('markdown without frontmatter', () => {
    expect(parseDocument('md', 'Just text')).toEqual({ body: 'Just text' })
    expect(serializeDocument('md', { body: 'Just text' })).toBe('Just text\n')
  })

  test('dates stay strings in YAML', () => {
    const data = parseDocument('md', '---\ndate: 2026-10-24\n---\n')
    expect(data.date).toBe('2026-10-24')
    expect(serializeDocument('md', { date: '2026-10-24' })).toBe('---\ndate: 2026-10-24\n---\n')
  })

  test('json and yaml round-trip', () => {
    const data = { title: 'Welkom', items: [{ q: 'Waarom?', a: 'Daarom.' }] }
    expect(parseDocument('json', serializeDocument('json', data))).toEqual(data)
    expect(parseDocument('yaml', serializeDocument('yaml', data))).toEqual(data)
  })

  test('rejects non-object documents', () => {
    expect(() => parseDocument('json', '[1,2]')).toThrow()
  })
})

describe('paths and slugs', () => {
  const res = parseConfig(VALID)
  if (!res.ok) throw new Error('config')
  const [posts, home] = res.config.collections as [never, never]

  test('slugify and templates', () => {
    expect(slugify('Ëen Brood & Banket!')).toBe('een-brood-banket')
    expect(renderSlug('{{year}}-{{title}}', { title: 'Hoi' }, new Date('2026-10-24'))).toBe(
      '2026-hoi',
    )
    expect(renderSlug('{{title}}', {})).toBe('')
  })

  test('only allows plain slugs inside the folder', () => {
    expect(entryPathFor(posts, 'hello', new Set())).toBe('src/content/posts/hello.md')
    expect(entryPathFor(posts, '../secrets', new Set())).toBeNull()
    expect(entryPathFor(posts, 'a/b', new Set())).toBeNull()
    expect(entryPathFor(posts, '.hidden', new Set())).toBeNull()
    expect(entryPathFor(home, '_', new Set())).toBe('src/content/pages/home.json')
    expect(entryPathFor(home, 'other', new Set())).toBeNull()
  })

  test('maps files back to slugs', () => {
    expect(slugForPath(posts, 'src/content/posts/hello.md')).toBe('hello')
    expect(slugForPath(posts, 'src/content/posts/nested/x.md')).toBeNull()
    expect(slugForPath(posts, 'src/content/posts/readme.txt')).toBeNull()
  })
})

describe('field checks', () => {
  const res = parseConfig(VALID)
  if (!res.ok) throw new Error('config')
  const [posts, home] = res.config.collections as [
    (typeof res.config.collections)[number],
    (typeof res.config.collections)[number],
  ]

  test('required is a soft issue, wrong types are invalid', () => {
    expect(checkFields(posts.fields, {})).toEqual([
      { path: 'title', code: 'required', message: 'This field is required' },
    ])
    expect(checkFields(posts.fields, { title: 'x', date: '24-10-2026' })[0]).toMatchObject({
      path: 'date',
      code: 'invalid',
    })
  })

  test('validates nested blocks and lists', () => {
    const issues = checkFields(home.fields, {
      sections: [
        { type: 'hero', heading: 'Hoi' },
        { type: 'faq', items: [{ q: 'a', a: 5 }] },
        { type: 'unknown' },
      ],
    })
    expect(issues.map((i) => i.path)).toEqual(['sections.1.items.0.a', 'sections.2'])
  })

  test('titles come from summary, title or the first string field', () => {
    expect(entryTitle(posts.fields, { title: ' Hoi ' })).toBe('Hoi')
    expect(entryTitle(posts.fields, {})).toBeNull()
  })
})

describe('published JSON schema', () => {
  test('schema/drikus-config.schema.json is up to date (run `bun run schema`)', async () => {
    const { SCHEMA_PATH, schemaText } = await import('../scripts/export-schema')
    expect(await Bun.file(SCHEMA_PATH).text()).toBe(schemaText())
  })
})

describe('documented example', () => {
  test('docs/examples/astro-bakery.config.yml is valid', async () => {
    const source = await Bun.file(
      new URL('../../../docs/examples/astro-bakery.config.yml', import.meta.url),
    ).text()
    const res = parseConfig(source)
    expect(res.ok ? [] : res.issues).toEqual([])
  })
})
