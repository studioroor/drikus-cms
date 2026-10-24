import { describe, expect, test } from 'bun:test'
import { paginate, parseStoredDate, sortEntries, sortOptions } from './collection-view'
import type { CollectionInfo, EntrySummary } from './content'

const entry = (slug: string, title: string | null, values: Record<string, unknown> = {}) =>
  ({ slug, title, values, status: 'published', invalid: false, updatedAt: null }) as EntrySummary

const collection = (sortBy: string | null, fields: object[]) =>
  ({ name: 'guestbook', sortBy, sortOrder: 'desc', fields }) as unknown as CollectionInfo

describe('sortOptions', () => {
  test('title first, then sortBy, then date fields', () => {
    const c = collection('score', [
      { name: 'title' },
      { name: 'score', label: 'Score' },
      { name: 'date', type: 'date' },
      { name: 'seen', type: 'datetime', label: { nl: 'Gezien', en: 'Seen' } },
    ])
    expect(sortOptions(c).map((o) => o.key)).toEqual(['title', 'score', 'date', 'seen'])
    expect(sortOptions(c)[3]?.label).toEqual({ nl: 'Gezien', en: 'Seen' })
  })

  test('does not repeat a sortBy that is a date field', () => {
    const c = collection('date', [{ name: 'date', type: 'date' }])
    expect(sortOptions(c).map((o) => o.key)).toEqual(['title', 'date'])
  })

  test('does not repeat a sortBy of title', () => {
    const c = collection('title', [{ name: 'title' }, { name: 'date', type: 'date' }])
    expect(sortOptions(c).map((o) => o.key)).toEqual(['title', 'date'])
  })

  test('no sortBy leaves just title and dates', () => {
    expect(sortOptions(collection(null, [{ name: 'x' }])).map((o) => o.key)).toEqual(['title'])
  })
})

describe('sortEntries', () => {
  const list = [
    entry('a', 'Anna', { date: '2026-01-01' }),
    entry('b', 'Bob'),
    entry('c', 'Carl', { date: '2026-03-01' }),
  ]

  test('date desc puts an entry without a date last', () => {
    expect(sortEntries(list, 'date', 'desc').map((e) => e.slug)).toEqual(['c', 'a', 'b'])
  })

  test('date asc also puts it last', () => {
    expect(sortEntries(list, 'date', 'asc').map((e) => e.slug)).toEqual(['a', 'c', 'b'])
  })

  test('title uses slug when missing and respects direction', () => {
    const l = [entry('zed', null), entry('m', 'Mia')]
    expect(sortEntries(l, 'title', 'asc').map((e) => e.slug)).toEqual(['m', 'zed'])
    expect(sortEntries(l, 'title', 'desc').map((e) => e.slug)).toEqual(['zed', 'm'])
  })

  test('ties fall back to title and the input is not mutated', () => {
    const l = [entry('b', 'Bob', { n: 1 }), entry('a', 'Anna', { n: 1 })]
    expect(sortEntries(l, 'n', 'desc').map((e) => e.slug)).toEqual(['a', 'b'])
    expect(l[0]?.slug).toBe('b')
  })
})

describe('parseStoredDate', () => {
  test('a date-only value keeps its calendar day in local time', () => {
    const p = parseStoredDate('2026-10-01')
    expect(p?.dateOnly).toBe(true)
    expect([p?.date.getFullYear(), p?.date.getMonth(), p?.date.getDate()]).toEqual([2026, 9, 1])
  })

  test('datetimes and non-dates', () => {
    expect(parseStoredDate('2026-10-01T12:00:00Z')?.dateOnly).toBe(false)
    expect(parseStoredDate('hello')).toBeNull()
    expect(parseStoredDate(5)).toBeNull()
  })
})

describe('paginate', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

  test('last page', () => {
    const p = paginate(range(60), 3)
    expect(p).toMatchObject({ page: 3, pages: 3, from: 51, to: 60 })
    expect(p.items).toHaveLength(10)
  })

  test('clamps the page', () => {
    expect(paginate(range(60), 99).page).toBe(3)
    expect(paginate(range(60), 0).page).toBe(1)
  })

  test('empty list', () => {
    expect(paginate([], 5)).toEqual({ items: [], page: 1, pages: 1, from: 0, to: 0 })
  })
})
