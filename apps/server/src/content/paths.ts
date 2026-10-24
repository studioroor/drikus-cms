import type { Collection } from './config'
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

/** Repository paths a collection may contain, given the files in the repo tree. */
export function entryPathFor(
  collection: Collection,
  slug: string,
  existing: Set<string>,
): string | null {
  if (collection.file) return slug === SINGLETON_SLUG ? collection.file : null
  if (!collection.folder || !isValidSlug(slug)) return null
  const candidates = FORMAT_EXTENSIONS[collection.format].map(
    (ext) => `${collection.folder}/${slug}.${ext}`,
  )
  return candidates.find((p) => existing.has(p)) ?? (candidates[0] as string)
}

/** Extracts the slug from a file directly inside a folder collection, or null. */
export function slugForPath(collection: Collection, path: string): string | null {
  if (!collection.folder || !path.startsWith(`${collection.folder}/`)) return null
  const name = path.slice(collection.folder.length + 1)
  if (name.includes('/')) return null
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  const slug = name.slice(0, dot)
  return FORMAT_EXTENSIONS[collection.format].includes(ext) && isValidSlug(slug) ? slug : null
}
