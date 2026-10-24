import { queryOptions } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError, api, unwrap } from './api'

const site = api.sites[':siteId']

const fetchContent = (siteId: string) => unwrap(site.content.$get({ param: { siteId } }))
const fetchEntries = (siteId: string, collection: string) =>
  unwrap(site.collections[':collection'].entries.$get({ param: { siteId, collection } })).then(
    (r) => r.entries,
  )
/** Language of an entry in a translated collection; undefined uses the site's main language. */
export type Locale = string | undefined

const q = (locale: Locale) => (locale ? { locale } : {})

const fetchEntry = (siteId: string, collection: string, slug: string, locale?: Locale) =>
  unwrap(
    site.collections[':collection'].entries[':slug'].$get({
      param: { siteId, collection, slug },
      query: q(locale),
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
export type LocaleState = NonNullable<Entry['locales']>[number]
export type SiteLocales = NonNullable<SiteContent['i18n']>
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

export const entryQuery = (siteId: string, collection: string, slug: string, locale?: Locale) =>
  queryOptions({
    queryKey: ['sites', siteId, 'entry', collection, slug, locale ?? null],
    queryFn: () => fetchEntry(siteId, collection, slug, locale),
    // The form owns the data while editing; don't refetch underneath it.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })

export const changesQuery = (siteId: string) =>
  queryOptions({ queryKey: ['sites', siteId, 'changes'], queryFn: () => fetchChanges(siteId) })

const fetchPublishPreview = (siteId: string) => unwrap(site.publish.$get({ param: { siteId } }))
const fetchPublishes = (siteId: string) =>
  unwrap(site.publishes.$get({ param: { siteId } })).then((r) => r.publishes)
const fetchDeployStatus = (siteId: string, publishId: string) =>
  unwrap(site.publishes[':publishId'].status.$get({ param: { siteId, publishId } }))

export type PublishPreview = Awaited<ReturnType<typeof fetchPublishPreview>>
export type PublishProblem = PublishPreview['problems'][number]
export type PublishRecord = Awaited<ReturnType<typeof fetchPublishes>>[number]
export type DeployState = PublishRecord['deployState']

export const publishPreviewQuery = (siteId: string) =>
  queryOptions({
    queryKey: ['sites', siteId, 'publish-preview'],
    queryFn: () => fetchPublishPreview(siteId),
    staleTime: 0,
    gcTime: 0,
  })

export const publishesQuery = (siteId: string) =>
  queryOptions({ queryKey: ['sites', siteId, 'publishes'], queryFn: () => fetchPublishes(siteId) })

/** Polls a publish's deploy state while it's still pending. */
export const deployStatusQuery = (siteId: string, publishId: string) =>
  queryOptions({
    queryKey: ['sites', siteId, 'deploy', publishId],
    queryFn: () => fetchDeployStatus(siteId, publishId),
    refetchInterval: (q) => (q.state.data && q.state.data.state !== 'pending' ? false : 4000),
  })

export function publishSite(siteId: string, message: string) {
  return unwrap(site.publish.$post({ param: { siteId }, json: message.trim() ? { message } : {} }))
}

export function resolveConflict(
  siteId: string,
  collection: string,
  slug: string,
  keep: 'mine' | 'theirs',
  locale?: string | null,
) {
  return unwrap(
    site.collections[':collection'].entries[':slug'].resolve.$post({
      param: { siteId, collection, slug },
      query: q(locale ?? undefined),
      json: { keep },
    }),
  )
}

const revisionsApi = site.collections[':collection'].entries[':slug'].revisions
const fetchRevisions = (siteId: string, collection: string, slug: string, locale?: Locale) =>
  unwrap(revisionsApi.$get({ param: { siteId, collection, slug }, query: q(locale) }))
const fetchRevision = (
  siteId: string,
  collection: string,
  slug: string,
  rev: string,
  locale?: Locale,
) =>
  unwrap(revisionsApi[':rev'].$get({ param: { siteId, collection, slug, rev }, query: q(locale) }))

export type RevisionList = Awaited<ReturnType<typeof fetchRevisions>>
export type Revision = RevisionList['revisions'][number]
/** A version of an entry: a commit SHA, or "draft" for the unpublished changes. */
export type VersionId = string

export const revisionsQuery = (siteId: string, collection: string, slug: string, locale?: Locale) =>
  queryOptions({
    queryKey: ['sites', siteId, 'revisions', collection, slug, locale ?? null],
    queryFn: () => fetchRevisions(siteId, collection, slug, locale),
  })

export const revisionQuery = (
  siteId: string,
  collection: string,
  slug: string,
  rev: VersionId,
  locale?: Locale,
) =>
  queryOptions({
    queryKey: ['sites', siteId, 'revision', collection, slug, rev, locale ?? null],
    queryFn: () => fetchRevision(siteId, collection, slug, rev, locale),
    // A commit never changes; only the draft does.
    staleTime: rev === 'draft' ? 0 : Number.POSITIVE_INFINITY,
  })

export function restoreRevision(
  siteId: string,
  collection: string,
  slug: string,
  rev: string,
  locale?: Locale,
) {
  return unwrap(
    revisionsApi[':rev'].restore.$post({
      param: { siteId, collection, slug, rev },
      query: q(locale),
    }),
  )
}

export function saveEntry(
  siteId: string,
  collection: string,
  slug: string,
  data: Data,
  locale?: Locale,
) {
  return unwrap(
    site.collections[':collection'].entries[':slug'].$put({
      param: { siteId, collection, slug },
      query: q(locale),
      json: { data },
    }),
  )
}

export function createEntry(siteId: string, collection: string, data: Data, locale?: Locale) {
  return unwrap(
    site.collections[':collection'].entries.$post({
      param: { siteId, collection },
      query: q(locale),
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

/**
 * URL to show an image or file used in content. Paths on the site go through
 * the CMS, which serves unpublished uploads and repo files (and otherwise
 * forwards to the live site); full URLs are used as they are.
 */
export function previewUrl(path: string, siteId: string, width?: 160 | 400 | 800): string | null {
  if (/^https?:\/\//.test(path)) return path
  if (!path.startsWith('/') || path.startsWith('//') || !siteId) return null
  const w = width ? `&w=${width}` : ''
  return `/api/sites/${encodeURIComponent(siteId)}/media/file?src=${encodeURIComponent(path)}${w}`
}

const fetchMedia = (siteId: string) => unwrap(site.media.$get({ param: { siteId } }))
export type MediaLibrary = Awaited<ReturnType<typeof fetchMedia>>
export type MediaItem = MediaLibrary['items'][number]

/** Pseudo collection name the server uses for uploads in change lists. */
export const MEDIA_COLLECTION = '@media'

export const mediaQuery = (siteId: string) =>
  queryOptions({ queryKey: ['sites', siteId, 'media'], queryFn: () => fetchMedia(siteId) })

/** Uploads a file; the server resizes/converts it and stages it for the next publish. */
export async function uploadMedia(siteId: string, file: File): Promise<MediaItem> {
  const form = new FormData()
  form.append('file', file)
  let res: Response
  try {
    res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/media`, {
      method: 'POST',
      body: form,
      headers: { 'x-drikus-csrf': '1' },
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('network', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; item?: MediaItem }
  if (res.status === 413) throw new ApiError('file_too_large', 413)
  if (!res.ok || !body.item) throw new ApiError(body.error ?? 'default', res.status)
  return body.item
}

export function removeMedia(siteId: string, src: string) {
  return unwrap(site.media.$delete({ param: { siteId }, query: { src } }))
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
