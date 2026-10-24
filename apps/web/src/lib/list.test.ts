import { describe, expect, test } from 'bun:test'
import type { Data, FieldDef } from './content'
import {
  hasImageField,
  isInlineList,
  itemFields,
  itemSnippet,
  matchesSearch,
  moveIds,
  reconcileIds,
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
