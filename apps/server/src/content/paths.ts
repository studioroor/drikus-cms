import { type Collection, LOCALE_TOKEN } from './config'
import { type Data, FORMAT_EXTENSIONS } from './format'

/** The only slugs accepted from clients: a plain file name without extension. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,119}$/i

/** Slug used in URLs for single-file collections. */
export const SINGLETON_SLUG = '_'

export function isValidSlug(slug: string) {
  return SLUG_PATTERN.test(slug)
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

/** Renders a slug template such as "{{year}}-{{title}}" from entry data. */
export function renderSlug(template: string, data: Data, now = new Date()): string {
  const vars: Record<string, string> = {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
  }
  const rendered = template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
    const value = data[key] ?? vars[key]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
  return slugify(rendered)
}

/** Fills in the language of a path template. */
export function localize(template: string, locale: string | null): string {
  return locale ? template.replaceAll(LOCALE_TOKEN, locale) : template
}

/**
 * The file of an entry (in one language, for translated collections), given
 * the files in the repo tree. Only plain slugs inside the collection's folder.
 */
export function entryPathFor(
  collection: Collection,
  slug: string,
  existing: Set<string>,
  locale: string | null = null,
): string | null {
  if (collection.translation && !locale) return null
  const loc = collection.translation === 'files' ? locale : null
  if (collection.file) return slug === SINGLETON_SLUG ? localize(collection.file, loc) : null
  if (!collection.folder || !isValidSlug(slug)) return null
  const folder = localize(collection.folder, loc)
  const name = collection.translation === 'suffix' ? `${slug}.${locale}` : slug
  const candidates = FORMAT_EXTENSIONS[collection.format].map((ext) => `${folder}/${name}.${ext}`)
  return candidates.find((p) => existing.has(p)) ?? (candidates[0] as string)
}

/**
 * Which entry (and language) a file directly inside a folder collection is,
 * or null if it isn't one.
 */
export function entryForPath(
  collection: Collection,
  path: string,
  locales: string[] = [],
): { slug: string; locale: string | null } | null {
  if (!collection.folder) return null
  const folders: [string, string | null][] =
    collection.translation === 'files'
      ? locales.map((l) => [localize(collection.folder as string, l), l])
      : [[collection.folder, null]]
  for (const [folder, folderLocale] of folders) {
    if (!path.startsWith(`${folder}/`)) continue
    const name = path.slice(folder.length + 1)
    if (name.includes('/')) return null
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return null
    const ext = name.slice(dot + 1).toLowerCase()
    if (!FORMAT_EXTENSIONS[collection.format].includes(ext)) return null
    let slug = name.slice(0, dot)
    let locale = folderLocale
    if (collection.translation === 'suffix') {
      const at = slug.lastIndexOf('.')
      locale = at > 0 ? slug.slice(at + 1) : null
      if (!locale || !locales.includes(locale)) return null
      slug = slug.slice(0, at)
    }
    return isValidSlug(slug) ? { slug, locale } : null
  }
  return null
}

/** Extracts the slug from a file directly inside an untranslated folder collection, or null. */
export function slugForPath(collection: Collection, path: string): string | null {
  return entryForPath(collection, path)?.slug ?? null
}
