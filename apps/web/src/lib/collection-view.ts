import type { CollectionInfo, EntrySummary, Label } from './content'

export type SortDir = 'asc' | 'desc'

export const PAGE_SIZE = 25

const isDateField = (type: string | undefined) => type === 'date' || type === 'datetime'

/** Keys an index can be sorted by: title, the collection's sortBy, then date fields. */
export function sortOptions(collection: CollectionInfo): { key: string; label: Label | string }[] {
  const options: { key: string; label: Label | string }[] = [{ key: 'title', label: 'title' }]
  const top = collection.fields
  const sortField = collection.sortBy ? top.find((f) => f.name === collection.sortBy) : undefined
  if (collection.sortBy && collection.sortBy !== 'title' && !isDateField(sortField?.type)) {
    options.push({ key: collection.sortBy, label: sortField?.label ?? collection.sortBy })
  }
  for (const f of top) {
    if (isDateField(f.type)) options.push({ key: f.name, label: f.label ?? f.name })
  }
  return options
}

const titleOf = (e: EntrySummary) => e.title ?? e.slug

const missing = (v: unknown) => v === undefined || v === null || v === ''

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  return String(a).localeCompare(String(b))
}

export function sortEntries(entries: EntrySummary[], key: string, dir: SortDir): EntrySummary[] {
  const sign = dir === 'desc' ? -1 : 1
  return [...entries].sort((a, b) => {
    if (key === 'title') {
      return sign * titleOf(a).localeCompare(titleOf(b)) || a.slug.localeCompare(b.slug)
    }
    const av = a.values[key]
    const bv = b.values[key]
    const am = missing(av)
    const bm = missing(bv)
    if (am !== bm) return am ? 1 : -1
    if (!am && !bm) {
      const c = compareValues(av, bv)
      if (c !== 0) return c * sign
    }
    return titleOf(a).localeCompare(titleOf(b))
  })
}

export function paginate<T>(
  list: T[],
  page: number,
  size = PAGE_SIZE,
): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(list.length / size))
  const current = Math.min(pages, Math.max(1, Math.floor(page) || 1))
  const start = (current - 1) * size
  const items = list.slice(start, start + size)
  return {
    items,
    page: current,
    pages,
    from: items.length ? start + 1 : 0,
    to: start + items.length,
  }
}

/** Parses a stored date or datetime; a date-only value is a local calendar day, not UTC midnight. */
export function parseStoredDate(value: unknown): { date: Date; dateOnly: boolean } | null {
  if (typeof value !== 'string') return null
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = only
    ? new Date(Number(only[1]), Number(only[2]) - 1, Number(only[3]))
    : /^\d{4}-\d{2}-\d{2}/.test(value)
      ? new Date(value)
      : null
  return date && !Number.isNaN(date.getTime()) ? { date, dateOnly: Boolean(only) } : null
}

/** A stored value as shown in the muted column of the index. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  const parsed = parseStoredDate(value)
  if (parsed) {
    return parsed.dateOnly ? parsed.date.toLocaleDateString() : parsed.date.toLocaleString()
  }
  return typeof value === 'object' ? '' : String(value)
}
