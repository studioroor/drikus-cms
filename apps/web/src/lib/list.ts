import type { Data, FieldDef } from './content'

export const asObject = (v: unknown): Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Data) : {}

export function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/** Appends `items` to `list` as far as `max` allows; the rest are dropped. */
export function appendUpTo<T>(
  list: T[],
  items: T[],
  max?: number,
): { list: T[]; added: number; dropped: number } {
  const room = max === undefined ? items.length : Math.max(0, max - list.length)
  const kept = items.slice(0, room)
  return { list: [...list, ...kept], added: kept.length, dropped: items.length - kept.length }
}

/** A list of single images, shown as a photo grid. */
export const isImageList = (field: FieldDef): boolean =>
  field.type === 'list' && field.field?.type === 'image'

/** The fields of a list item or block; null for a block type that isn't defined. */
export function itemFields(field: FieldDef, item: unknown): FieldDef[] | null {
  if (field.type === 'blocks') {
    const type = asObject(item)[field.typeKey]
    return field.blocks?.find((b) => b.name === type)?.fields ?? null
  }
  return field.fields ?? []
}

/** Index of the field `itemTitle` takes its text from, or -1. */
function titleIndex(fields: FieldDef[], item: Data): number {
  return fields.findIndex((f) => {
    const v = item[f.name]
    return (f.type === 'string' || f.type === 'text') && typeof v === 'string' && v.trim() !== ''
  })
}

export function itemTitle(fields: FieldDef[], item: Data): string | null {
  const i = titleIndex(fields, item)
  return i < 0 ? null : (item[(fields[i] as FieldDef).name] as string).trim().slice(0, 80)
}

/** A one-line preview: the first text value after the one used as the title. */
export function itemSnippet(fields: FieldDef[], item: Data): string | null {
  for (const f of fields.slice(titleIndex(fields, item) + 1)) {
    const v = item[f.name]
    if (
      (f.type === 'string' || f.type === 'text' || f.type === 'markdown') &&
      typeof v === 'string' &&
      v.trim()
    )
      return v.replace(/\s+/g, ' ').trim().slice(0, 120)
  }
  return null
}

/** Image fields at the top level or one level into an object field, with how to read them. */
function imageReaders(fields: FieldDef[]): ((item: Data) => unknown)[] {
  const readers: ((item: Data) => unknown)[] = []
  for (const f of fields) {
    if (f.type === 'image') readers.push((item) => item[f.name])
    else if (f.type === 'object')
      for (const g of f.fields ?? [])
        if (g.type === 'image') readers.push((item) => asObject(item[f.name])[g.name])
  }
  return readers
}

export const hasImageField = (fields: FieldDef[]): boolean => imageReaders(fields).length > 0

export function thumbnailOf(fields: FieldDef[], item: Data): string | null {
  const first = imageReaders(fields)[0]
  const v = first?.(item)
  return typeof v === 'string' && v ? v : null
}

const SEARCHABLE = new Set(['string', 'text', 'markdown', 'richtext', 'url'])

export function matchesSearch(fields: FieldDef[], item: Data, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => {
    const v = item[f.name]
    return SEARCHABLE.has(f.type) && typeof v === 'string' && v.toLowerCase().includes(needle)
  })
}

export type ChainLevel = {
  listPath: string
  index: number
  field: FieldDef
  fields: FieldDef[] | null
  item: Data
}

const parseIndex = (s: string | undefined, length: number): number | null => {
  if (s === undefined || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return n < length ? n : null
}

/**
 * The selected item and each list/blocks item it sits in, outermost first. `selected` is a
 * dot path such as `services.1.packages.0`; the chain stops at the first segment that
 * doesn't resolve.
 */
export function resolveChain(
  field: FieldDef,
  listPath: string,
  value: unknown[],
  selected: string | null,
): ChainLevel[] {
  if (!selected?.startsWith(`${listPath}.`)) return []
  const levels: ChainLevel[] = []
  let segments = selected.slice(listPath.length + 1).split('.')
  let current = field
  let path = listPath
  let items = value
  for (;;) {
    const index = parseIndex(segments[0], items.length)
    if (index === null) break
    const item = asObject(items[index])
    const fields = itemFields(current, item)
    levels.push({ listPath: path, index, field: current, fields, item })
    // Step through object fields (`meta.links`) to the list the next index is in.
    let rest = segments.slice(1)
    let holder = item
    let holderFields = fields
    let child = holderFields?.find((f) => f.name === rest[0])
    let childPath = `${path}.${index}`
    while (child?.type === 'object') {
      holder = asObject(holder[child.name])
      holderFields = child.fields ?? []
      childPath = `${childPath}.${child.name}`
      rest = rest.slice(1)
      child = holderFields.find((f) => f.name === rest[0])
    }
    if (!child || (child.type !== 'blocks' && !(child.type === 'list' && child.fields))) break
    const childItems = holder[child.name]
    if (!Array.isArray(childItems)) break
    path = `${childPath}.${child.name}`
    items = childItems
    current = child
    segments = rest.slice(1)
  }
  return levels
}

/** Immutable update at a path into nested arrays/objects; siblings and unknown keys are kept. */
export const setIn = (value: unknown[], segments: (string | number)[], next: unknown): unknown[] =>
  setNested(value, segments, next) as unknown[]

function setNested(container: unknown, segments: (string | number)[], next: unknown): unknown {
  const [head, ...rest] = segments
  if (head === undefined) return next
  if (typeof head === 'number') {
    const list = Array.isArray(container) ? [...container] : []
    list[head] = setNested(list[head], rest, next)
    return list
  }
  const obj = { ...asObject(container) }
  obj[head] = setNested(obj[head], rest, next)
  return obj
}

/** Stable keys for list rows, kept in step with the list as it shrinks or grows. */
export function reconcileIds(ids: string[], length: number): string[] {
  if (ids.length === length) return ids
  const kept = ids.slice(0, length)
  while (kept.length < length) kept.push(crypto.randomUUID())
  return kept
}

export const insertId = (ids: string[], at: number): string[] => [
  ...ids.slice(0, at),
  crypto.randomUUID(),
  ...ids.slice(at),
]

export const removeId = (ids: string[], at: number): string[] => ids.filter((_, i) => i !== at)

export const moveIds = (ids: string[], from: number, to: number): string[] => move(ids, from, to)

/** Where item `i` of a list ends up after a move, a removal (null: gone) or an insertion. */
export const movedIndex =
  (from: number, to: number) =>
  (i: number): number => {
    if (i === from) return to
    if (from < to && i > from && i <= to) return i - 1
    if (to < from && i >= to && i < from) return i + 1
    return i
  }
export const removedIndex =
  (at: number) =>
  (i: number): number | null =>
    i === at ? null : i > at ? i - 1 : i
export const insertedIndex =
  (at: number) =>
  (i: number): number =>
    i >= at ? i + 1 : i

/** Whether `path` lies inside one of the items of the list at `listPath`. */
export const insideItemOf = (path: string, listPath: string): boolean =>
  path.startsWith(`${listPath}.`)

/**
 * Re-keys entries stored by path under the items of the list at `listPath`
 * (`${listPath}.${i}.…`) to the items' new indexes; entries remapped to null are dropped.
 */
export function rekeyPaths<T>(
  map: Map<string, T>,
  listPath: string,
  remap: (i: number) => number | null,
): Map<string, T> {
  const prefix = `${listPath}.`
  const next = new Map<string, T>()
  for (const [key, v] of map) {
    const m = key.startsWith(prefix) ? /^(\d+)(\..+)$/.exec(key.slice(prefix.length)) : null
    if (!m) {
      next.set(key, v)
      continue
    }
    const i = remap(Number(m[1]))
    if (i !== null) next.set(`${prefix}${i}${m[2]}`, v)
  }
  return next
}

/** Lists of objects and blocks are edited in the two-pane list editor. */
export const usesListEditor = (field: FieldDef): boolean =>
  (field.type === 'list' && !!field.fields) || field.type === 'blocks'

export const hasListEditor = (fields: FieldDef[]): boolean =>
  fields.some(
    (f) => usesListEditor(f) || (f.type === 'object' && (f.fields ?? []).some(usesListEditor)),
  )

const INLINE_TYPES = new Set([
  'string',
  'url',
  'number',
  'boolean',
  'date',
  'datetime',
  'color',
  'select',
  'reference',
  'image',
])

/** Short lists of simple fields are edited in place instead of in two panes. */
export const isInlineList = (field: FieldDef, value: unknown[]): boolean =>
  value.length <= 3 &&
  field.type === 'list' &&
  (field.fields ?? []).every((f) => INLINE_TYPES.has(f.type))
