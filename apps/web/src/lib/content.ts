import { queryOptions } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, unwrap } from './api'

const site = api.sites[':siteId']

const fetchContent = (siteId: string) => unwrap(site.content.$get({ param: { siteId } }))
const fetchEntries = (siteId: string, collection: string) =>
  unwrap(site.collections[':collection'].entries.$get({ param: { siteId, collection } })).then(
    (r) => r.entries,
  )
const fetchEntry = (siteId: string, collection: string, slug: string) =>
  unwrap(
    site.collections[':collection'].entries[':slug'].$get({
      param: { siteId, collection, slug },
    }),
  )
const fetchChanges = (siteId: string) =>
  unwrap(site.changes.$get({ param: { siteId } })).then((r) => r.changes)

export type SiteContent = Awaited<ReturnType<typeof fetchContent>>
export type CollectionInfo = SiteContent['collections'][number]
export type FieldDef = CollectionInfo['fields'][number]
export type EntrySummary = Awaited<ReturnType<typeof fetchEntries>>[number]
export type Entry = Awaited<ReturnType<typeof fetchEntry>>
export type EntryStatus = Entry['status']
export type Data = Record<string, unknown>
export type Label = CollectionInfo['label']

/** Slug used in URLs for single-file collections. */
export const SINGLETON_SLUG = '_'

export const siteContentQuery = (siteId: string) =>
  queryOptions({ queryKey: ['sites', siteId, 'content'], queryFn: () => fetchContent(siteId) })

export const entriesQuery = (siteId: string, collection: string) =>
  queryOptions({
    queryKey: ['sites', siteId, 'entries', collection],
    queryFn: () => fetchEntries(siteId, collection),
  })

export const entryQuery = (siteId: string, collection: string, slug: string) =>
  queryOptions({
    queryKey: ['sites', siteId, 'entry', collection, slug],
    queryFn: () => fetchEntry(siteId, collection, slug),
    // The form owns the data while editing; don't refetch underneath it.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })

export const changesQuery = (siteId: string) =>
  queryOptions({ queryKey: ['sites', siteId, 'changes'], queryFn: () => fetchChanges(siteId) })

export function saveEntry(siteId: string, collection: string, slug: string, data: Data) {
  return unwrap(
    site.collections[':collection'].entries[':slug'].$put({
      param: { siteId, collection, slug },
      json: { data },
    }),
  )
}

export function createEntry(siteId: string, collection: string, data: Data) {
  return unwrap(
    site.collections[':collection'].entries.$post({
      param: { siteId, collection },
      json: { data },
    }),
  )
}

export function deleteEntry(siteId: string, collection: string, slug: string) {
  return unwrap(
    site.collections[':collection'].entries[':slug'].$delete({
      param: { siteId, collection, slug },
    }),
  )
}

export function discardEntry(siteId: string, collection: string, slug: string) {
  return unwrap(
    site.collections[':collection'].entries[':slug'].discard.$post({
      param: { siteId, collection, slug },
    }),
  )
}

/** "heroImage" / "hero_image" → "Hero image" */
export function humanize(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Where to load a stored image path from for a preview, or null if it can't be shown. */
export function previewUrl(path: string, siteUrl: string | null): string | null {
  if (/^https?:\/\//.test(path)) return path
  if (path.startsWith('/') && siteUrl) return `${siteUrl.replace(/\/$/, '')}${path}`
  return null
}

/** Resolves config labels, which can be a string or one per UI language. */
export function useLabel() {
  const { i18n } = useTranslation()
  return (label: Label | undefined, fallbackName?: string): string => {
    if (typeof label === 'string') return label
    if (label) {
      const own = label[i18n.language as 'nl' | 'en']
      const other = label.nl ?? label.en
      if (own ?? other) return (own ?? other) as string
    }
    return fallbackName ? humanize(fallbackName) : ''
  }
}

/** Defaults for a new entry, mirroring the server's rules. */
export function defaultData(fields: FieldDef[]): Data {
  const data: Data = {}
  for (const f of fields) {
    if (f.default !== undefined) data[f.name] = f.default
    else if (f.type === 'boolean') data[f.name] = false
  }
  return data
}
