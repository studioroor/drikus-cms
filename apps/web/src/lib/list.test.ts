import { describe, expect, test } from 'bun:test'
import type { Data, FieldDef } from './content'
import {
  hasImageField,
  insertedIndex,
  insideItemOf,
  isInlineList,
  itemFields,
  itemSnippet,
  matchesSearch,
  movedIndex,
  moveIds,
  reconcileIds,
  rekeyPaths,
  removedIndex,
  resolveChain,
  setIn,
  thumbnailOf,
} from './list'

const f = (o: Record<string, unknown>) => o as unknown as FieldDef

const services = f({
  name: 'services',
  type: 'list',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'icon', type: 'image' },
    { name: 'intro', type: 'text' },
    {
      name: 'packages',
      type: 'list',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'image', type: 'image' },
      ],
    },
  ],
})
const serviceFields = services.fields as FieldDef[]

const data = [
  { title: 'Coaching', icon: '/a.webp', packages: [] },
  {
    title: 'Review Focus',
    extra: 1,
    packages: [{ name: 'Basis', image: '/b.webp' }, { name: 'Plus' }],
  },
]

describe('resolveChain', () => {
  test('walks nested lists', () => {
    const chain = resolveChain(services, 'services', data, 'services.1.packages.0')
    expect(chain).toHaveLength(2)
    const last = chain[1]
    expect(last?.index).toBe(0)
    expect(last?.listPath).toBe('services.1.packages')
    expect(last?.item.name).toBe('Basis')
  })

  test('stops at an unresolved segment', () => {
    expect(resolveChain(services, 'services', data, 'services.9')).toEqual([])
    expect(resolveChain(services, 'services', data, 'services.1.packages.7')).toHaveLength(1)
    expect(resolveChain(services, 'services', data, 'reviews.0')).toEqual([])
    expect(resolveChain(services, 'services', data, null)).toEqual([])
  })

  test('walks through object fields to a nested list', () => {
    const team = f({
      name: 'team',
      type: 'list',
      fields: [
        {
          name: 'meta',
          type: 'object',
          fields: [{ name: 'links', type: 'list', fields: [{ name: 'label', type: 'string' }] }],
        },
      ],
    })
    const value = [{ meta: { links: [{ label: 'a' }, { label: 'b' }] } }]
    const chain = resolveChain(team, 'team', value, 'team.0.meta.links.1')
    expect(chain).toHaveLength(2)
    expect(chain[1]?.listPath).toBe('team.0.meta.links')
    expect(chain[1]?.item.label).toBe('b')
    expect(resolveChain(team, 'team', value, 'team.0.meta.nope.0')).toHaveLength(1)
  })
})

describe('setIn', () => {
  test('updates one value immutably', () => {
    const next = setIn(data, [1, 'packages', 0, 'name'], 'X') as Data[]
    const packages = (next[1] as Data).packages as Data[]
    expect(packages[0]?.name).toBe('X')
    expect(next[0]).toBe(data[0] as Data)
    expect((next[1] as Data).extra).toBe(1)
    expect(data[1]?.packages[0]?.name).toBe('Basis')
  })

  test('replaces non-object containers', () => {
    expect(setIn(['oops', { a: 1 }], [0, 'title'], 'T')).toEqual([{ title: 'T' }, { a: 1 }])
  })
})

describe('ids', () => {
  test('reconcileIds keeps, trims and grows', () => {
    const same = ['a', 'b']
    expect(reconcileIds(same, 2)).toBe(same)
    expect(reconcileIds(['a', 'b', 'c'], 1)).toEqual(['a'])
    const grown = reconcileIds(['a'], 3)
    expect(grown).toHaveLength(3)
    expect(grown[0]).toBe('a')
    expect(new Set(grown).size).toBe(3)
    const fresh = reconcileIds([], 2)
    expect(fresh[0]).not.toBe(fresh[1])
  })

  test('moveIds', () => {
    expect(moveIds(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
})

describe('thumbnails', () => {
  test('thumbnailOf and hasImageField', () => {
    expect(thumbnailOf(serviceFields, data[0] as Data)).toBe('/a.webp')
    expect(thumbnailOf(serviceFields, data[1] as Data)).toBeNull()
    const hero = [f({ name: 'hero', type: 'object', fields: [{ name: 'image', type: 'image' }] })]
    expect(hasImageField(hero)).toBe(true)
    expect(thumbnailOf(hero, { hero: { image: '/h.webp' } })).toBe('/h.webp')
    expect(hasImageField([f({ name: 't', type: 'string' })])).toBe(false)
  })
})

describe('itemSnippet and matchesSearch', () => {
  test('snippet skips the title and collapses whitespace', () => {
    expect(itemSnippet(serviceFields, { title: 'T', intro: 'a\n\nb' })).toBe('a b')
    expect(itemSnippet(serviceFields, { title: 'T' })).toBeNull()
  })

  test('search is case-insensitive', () => {
    expect(matchesSearch(serviceFields, { intro: 'Hi Valeria' }, 'valeria')).toBe(true)
    expect(matchesSearch(serviceFields, { intro: 'Hi' }, 'valeria')).toBe(false)
    expect(matchesSearch(serviceFields, {}, '')).toBe(true)
  })
})

describe('isInlineList', () => {
  const simple = f({
    type: 'list',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'url', type: 'url' },
    ],
  })

  test('depends on size and field types', () => {
    expect(isInlineList(simple, [1, 2])).toBe(true)
    expect(isInlineList(simple, [1, 2, 3, 4])).toBe(false)
    const withText = f({ type: 'list', fields: [{ name: 'a', type: 'text' }] })
    expect(isInlineList(withText, [1])).toBe(false)
  })
})

describe('itemFields', () => {
  const blocks = f({
    name: 'sections',
    type: 'blocks',
    typeKey: 'type',
    blocks: [{ name: 'hero', fields: [{ name: 'title', type: 'string' }] }],
  })

  test('lists and blocks', () => {
    expect(itemFields(blocks, { type: 'hero' })?.[0]?.name).toBe('title')
    expect(itemFields(blocks, { type: 'nope' })).toBeNull()
    expect(itemFields(services, {})).toBe(serviceFields)
  })
})

describe('rekeyPaths', () => {
  const map = () =>
    new Map([
      ['services', 'list'],
      ['services.0.packages', 'a'],
      ['services.1.packages', 'b'],
      ['services.1.packages.0.extras', 'b0'],
      ['services.2.packages', 'c'],
      ['services.10.packages', 'k'],
      ['other.1.packages', 'x'],
    ])
  const keys = (m: Map<string, string>) => Object.fromEntries(m)

  test('index remaps', () => {
    expect([0, 1, 2, 3].map(movedIndex(0, 2))).toEqual([2, 0, 1, 3])
    expect([0, 1, 2, 3].map(movedIndex(2, 0))).toEqual([1, 2, 0, 3])
    expect([0, 1, 2].map(removedIndex(1))).toEqual([0, null, 1])
    expect([0, 1, 2].map(insertedIndex(1))).toEqual([0, 2, 3])
  })

  test('moves entries under an item along with it', () => {
    expect(keys(rekeyPaths(map(), 'services', movedIndex(1, 0)))).toEqual({
      services: 'list',
      'services.1.packages': 'a',
      'services.0.packages': 'b',
      'services.0.packages.0.extras': 'b0',
      'services.2.packages': 'c',
      'services.10.packages': 'k',
      'other.1.packages': 'x',
    })
  })

  test('drops entries of a removed item and shifts the rest', () => {
    expect(keys(rekeyPaths(map(), 'services', removedIndex(1)))).toEqual({
      services: 'list',
      'services.0.packages': 'a',
      'services.1.packages': 'c',
      'services.9.packages': 'k',
      'other.1.packages': 'x',
    })
  })

  test('makes room for an inserted item', () => {
    expect(keys(rekeyPaths(map(), 'services', insertedIndex(0)))).toEqual({
      services: 'list',
      'services.1.packages': 'a',
      'services.2.packages': 'b',
      'services.2.packages.0.extras': 'b0',
      'services.3.packages': 'c',
      'services.11.packages': 'k',
      'other.1.packages': 'x',
    })
  })
})

describe('insideItemOf', () => {
  test('a path inside an item of the list', () => {
    expect(insideItemOf('services.1.packages.0.extras', 'services.1.packages')).toBe(true)
    expect(insideItemOf('services.1.packages', 'services')).toBe(true)
    expect(insideItemOf('services.1.packages', 'services.1.packages')).toBe(false)
    expect(insideItemOf('services.10.packages', 'services.1')).toBe(false)
    expect(insideItemOf('other.0.x', 'services')).toBe(false)
  })
})
