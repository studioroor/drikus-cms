import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { type StagedMedia, stagedMedia, users } from '../db/schema'
import { gitBlobSha } from '../github/sha'
import type { Config } from './config'
import { slugForPath, slugify } from './paths'
import { ContentError, type ContentService } from './service'

/** Pseudo collection name used for uploads in change lists and publish summaries. */
export const MEDIA_COLLECTION = '@media'

const PROTECTED_ROOTS = ['.git', '.github', '.drikus']
const MAX_INPUT_PIXELS = 80_000_000
const THUMB_WIDTHS = [160, 400, 800] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

export interface MediaSettings {
  folder: string
  publicPath: string
  maxWidth: number
  format: 'webp' | 'original'
  quality: number
  maxBytes: number
}

export function mediaSettings(config: Config): MediaSettings {
  const m = config.media
  const folder = m?.folder ?? 'public/uploads'
  // Vite/Astro serve public/ at the site root, so public/uploads → /uploads.
  const derived = folder.startsWith('public/') ? `/${folder.slice('public/'.length)}` : `/${folder}`
  return {
    folder,
    publicPath: (m?.publicPath ?? derived).replace(/\/+$/, '') || '',
    maxWidth: m?.maxWidth ?? 2000,
    format: m?.format ?? 'webp',
    quality: m?.quality ?? 82,
    maxBytes: Math.round((m?.maxSizeMb ?? 15) * 1024 * 1024),
  }
}

// --- File types --------------------------------------------------------------

type Kind = 'image' | 'file'
interface FileType {
  ext: string
  mime: string
  kind: Kind
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}
const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
}

/** Content type for serving a repo file by its extension, or null if we don't serve it. */
export function typeForPath(path: string): FileType | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_TYPES[ext]) return { ext, mime: IMAGE_TYPES[ext] as string, kind: 'image' }
  if (FILE_TYPES[ext]) return { ext, mime: FILE_TYPES[ext] as string, kind: 'file' }
  return null
}

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1')

/**
 * Detects the real type from the file's bytes; the name and the browser's
 * content type are not trusted. SVG is refused on purpose: it can carry scripts.
 */
export function sniff(bytes: Buffer, filename: string): FileType | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return { ext: 'jpg', mime: 'image/jpeg', kind: 'image' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ext: 'png', mime: 'image/png', kind: 'image' }
  if (ascii(bytes, 0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif', kind: 'image' }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp', kind: 'image' }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12)
    if (['avif', 'avis'].includes(brand)) return { ext: 'avif', mime: 'image/avif', kind: 'image' }
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand))
      return { ext: 'heic', mime: 'image/heic', kind: 'image' }
    return { ext: 'mp4', mime: 'video/mp4', kind: 'file' }
  }
  if (ascii(bytes, 0, 5) === '%PDF-')
    return { ext: 'pdf', mime: FILE_TYPES.pdf as string, kind: 'file' }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const zipExt = ['docx', 'xlsx', 'pptx'].includes(ext) ? ext : 'zip'
    return { ext: zipExt, mime: FILE_TYPES[zipExt] as string, kind: 'file' }
  }
  if (
    ascii(bytes, 0, 3) === 'ID3' ||
    startsWith(bytes, [0xff, 0xfb]) ||
    startsWith(bytes, [0xff, 0xf3])
  )
    return { ext: 'mp3', mime: FILE_TYPES.mp3 as string, kind: 'file' }
  if ((ext === 'txt' || ext === 'csv') && !bytes.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return { ext, mime: FILE_TYPES[ext] as string, kind: 'file' }
    } catch {
      return null
    }
  }
  return null
}

export interface ProcessedUpload {
  name: string
  bytes: Buffer
  kind: Kind
  width: number | null
  height: number | null
}

/**
 * Makes an upload safe and web-friendly: images are rotated upright, scaled
 * down, stripped of metadata (camera details, GPS location) and converted to
 * WebP unless the site keeps originals. Other files are stored as they are.
 * The name gets a short content hash, so different files never collide.
 */
export async function processUpload(
  input: Buffer,
  filename: string,
  settings: MediaSettings,
): Promise<ProcessedUpload> {
  if (input.length > settings.maxBytes) throw new ContentError('file_too_large', 400)
  const type = sniff(input, filename)
  if (!type) throw new ContentError('unsupported_file', 400)

  const base = slugify(filename.replace(/\.[^.]*$/, '')).slice(0, 60) || 'bestand'
  let bytes = input
  let ext = type.ext
  let width: number | null = null
  let height: number | null = null

  if (type.kind === 'image') {
    try {
      const animated = type.ext === 'gif' || type.ext === 'webp'
      let image = sharp(input, { animated, limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: settings.maxWidth, withoutEnlargement: true })
      const keep = settings.format === 'original' && ['jpg', 'png', 'gif'].includes(type.ext)
      if (keep && type.ext === 'jpg')
        image = image.jpeg({ quality: settings.quality, mozjpeg: true })
      else if (keep && type.ext === 'png') image = image.png({ compressionLevel: 9 })
      else if (keep && type.ext === 'gif') image = image.gif()
      else {
        image = image.webp({ quality: settings.quality })
        ext = 'webp'
      }
      // sharp drops metadata unless asked to keep it.
      const out = await image.toBuffer({ resolveWithObject: true })
      bytes = out.data
      width = out.info.width
      height = out.info.pageHeight ?? out.info.height
    } catch {
      throw new ContentError('invalid_image', 400)
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  return { name: `${base}-${hash}.${ext}`, bytes, kind: type.kind, width, height }
}

/** A path inside the repo that we may write or serve. */
export function isSafeRepoPath(path: string) {
  const parts = path.split('/')
  return (
    /^[A-Za-z0-9._\-/]+$/.test(path) &&
    parts.every((p) => p !== '' && p !== '.' && p !== '..') &&
    !PROTECTED_ROOTS.includes(parts[0] as string)
  )
}

// --- Service -----------------------------------------------------------------

export interface MediaItem {
  src: string
  path: string
  name: string
  kind: Kind
  size: number
  status: 'new' | 'published'
  uploadedAt: number | null
  uploadedBy: string | null
  /** Whether any published file or pending draft of a collection mentions this file. */
  used: boolean
}

/** Which srcs content mentions, per site, head commit and latest draft change. */
const usageCache = new Map<string, Map<string, boolean>>()
const MAX_USAGE_KEYS = 50

/** Small cache of generated thumbnails, by blob SHA and width. */
const thumbs = new Map<string, Buffer>()
const MAX_THUMBS = 300

export class MediaService {
  constructor(readonly content: ContentService) {}

  get #db() {
    return this.content.db
  }
  get #siteId() {
    return this.content.site.id
  }

  async settings() {
    return mediaSettings(await this.content.config())
  }

  staged(): StagedMedia[] {
    return this.#db.select().from(stagedMedia).where(eq(stagedMedia.siteId, this.#siteId)).all()
  }

  #srcFor(settings: MediaSettings, path: string) {
    return `${settings.publicPath}${path.slice(settings.folder.length)}`
  }

  /** Maps a value used in content (/uploads/x.webp#right) to a repo path, if it's a repo file. */
  async pathForSrc(src: string): Promise<string | null> {
    const settings = await this.settings()
    let clean: string
    try {
      clean = decodeURI(src.split(/[?#]/)[0] ?? '')
    } catch {
      return null
    }
    if (!clean.startsWith('/')) return null
    const candidates: string[] = []
    if (settings.publicPath && clean.startsWith(`${settings.publicPath}/`)) {
      candidates.push(`${settings.folder}${clean.slice(settings.publicPath.length)}`)
    }
    // Vite/Astro: files in public/ are served from the site root.
    candidates.push(`public${clean}`)
    const files = await this.content.files()
    const staged = new Set(this.staged().map((m) => m.path))
    return (
      candidates.find(
        (p) => isSafeRepoPath(p) && typeForPath(p) && (files.has(p) || staged.has(p)),
      ) ?? null
    )
  }

  /** The subset of `srcs` that appears in a collection's published file or pending draft. */
  async usage(srcs: string[]): Promise<Set<string>> {
    const site = this.content.site
    const head = await this.content.sync.head(site)
    const drafts = this.content.drafts()
    // Covers every draft, so discarding or editing any one of them changes the key.
    const stamp = createHash('sha256')
      .update(
        drafts
          .map((d) => `${d.path}@${d.updatedAt?.getTime() ?? 0}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16)
    const key = `${site.id}:${head.commitSha}:${drafts.length}:${stamp}`
    let known = usageCache.get(key)
    if (!known) {
      known = new Map()
      usageCache.set(key, known)
      if (usageCache.size > MAX_USAGE_KEYS)
        usageCache.delete(usageCache.keys().next().value as string)
    }
    const missing = srcs.filter((s) => !known.has(s))
    if (missing.length) {
      const { texts, complete } = await this.#contentTexts(drafts)
      // A file we couldn't read might use anything: count it as used, and don't cache that.
      if (!complete) return new Set(srcs)
      for (const src of missing)
        known.set(
          src,
          texts.some((t) => t.includes(src)),
        )
    }
    return new Set(srcs.filter((s) => known.get(s)))
  }

  /**
   * Text of every published entry file plus every upsert draft. Only entry files count: other
   * files in a collection folder (co-located images, PDFs) aren't content and needn't be fetched.
   */
  async #contentTexts(
    drafts: ReturnType<ContentService['drafts']>,
  ): Promise<{ texts: string[]; complete: boolean }> {
    const config = await this.content.config()
    const files = await this.content.files()
    const owned = (path: string) =>
      config.collections.some((c) => (c.folder ? slugForPath(c, path) !== null : path === c.file))
    const paths = [...files.keys()].filter(owned)
    const texts: string[] = []
    let complete = true
    const queue = [...paths]
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const sha = files.get(p) as string
        try {
          texts.push((await this.content.sync.blob(this.content.site, sha)).toString('utf8'))
        } catch {
          complete = false
        }
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    for (const d of drafts) if (d.action !== 'delete' && d.content) texts.push(d.content)
    return { texts, complete }
  }

  async list(): Promise<{ settings: MediaSettings; items: MediaItem[]; complete: boolean }> {
    const settings = await this.settings()
    const head = await this.content.sync.head(this.content.site)
    const tree = await this.content.sync.tree(this.content.site, head.treeSha)
    const names = new Map(
      this.#db
        .select({ id: users.id, name: users.name })
        .from(users)
        .all()
        .map((u) => [u.id, u.name]),
    )
    const items: MediaItem[] = this.staged().map((m) => ({
      src: this.#srcFor(settings, m.path),
      path: m.path,
      name: m.path.split('/').pop() as string,
      kind: m.kind,
      size: m.size,
      status: 'new' as const,
      uploadedAt: m.createdAt.getTime(),
      uploadedBy: m.uploadedBy ? (names.get(m.uploadedBy) ?? null) : null,
      used: false,
    }))
    const stagedPaths = new Set(items.map((i) => i.path))
    for (const entry of tree.entries) {
      if (entry.type !== 'blob' || !entry.path.startsWith(`${settings.folder}/`)) continue
      const type = typeForPath(entry.path)
      if (!type || stagedPaths.has(entry.path)) continue
      items.push({
        src: this.#srcFor(settings, entry.path),
        path: entry.path,
        name: entry.path.split('/').pop() as string,
        kind: type.kind,
        size: entry.size ?? 0,
        status: 'published',
        uploadedAt: null,
        uploadedBy: null,
        used: false,
      })
    }
    const used = await this.usage(items.map((i) => i.src))
    for (const item of items) item.used = used.has(item.src)
    items.sort((a, b) =>
      a.status !== b.status ? (a.status === 'new' ? -1 : 1) : a.name.localeCompare(b.name),
    )
    return { settings, items, complete: !tree.truncated }
  }

  async upload(file: File, userId: string): Promise<MediaItem> {
    const settings = await this.settings()
    const processed = await processUpload(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      settings,
    )
    const path = `${settings.folder}/${processed.name}`
    if (!isSafeRepoPath(path)) throw new ContentError('unsupported_file', 400)
    const item: MediaItem = {
      src: this.#srcFor(settings, path),
      path,
      name: processed.name,
      kind: processed.kind,
      size: processed.bytes.length,
      status: 'new',
      uploadedAt: Date.now(),
      uploadedBy: null,
      used: false,
    }
    // The same file is already on GitHub: nothing to stage.
    if ((await this.content.files()).get(path) === gitBlobSha(processed.bytes)) {
      return { ...item, status: 'published', uploadedAt: null }
    }
    this.#db
      .insert(stagedMedia)
      .values({
        siteId: this.#siteId,
        path,
        bytes: processed.bytes,
        size: processed.bytes.length,
        kind: processed.kind,
        width: processed.width,
        height: processed.height,
        uploadedBy: userId,
      })
      .onConflictDoNothing()
      .run()
    return item
  }

  /** Removes an upload that hasn't been published yet. */
  async remove(src: string) {
    const path = await this.pathForSrc(src)
    const staged = path ? this.staged().find((m) => m.path === path) : undefined
    if (!staged) throw new ContentError('cannot_delete', 400)
    this.#db
      .delete(stagedMedia)
      .where(and(eq(stagedMedia.siteId, this.#siteId), eq(stagedMedia.path, staged.path)))
      .run()
    return { ok: true as const }
  }

  /** Bytes of a media file (staged or published), optionally as a thumbnail. */
  async read(
    src: string,
    width?: ThumbWidth,
  ): Promise<{ bytes: Buffer; type: FileType; etag: string } | null> {
    const path = await this.pathForSrc(src)
    const type = path ? typeForPath(path) : null
    if (!path || !type) return null
    const staged = this.staged().find((m) => m.path === path)
    const sha = staged ? gitBlobSha(staged.bytes) : (await this.content.files()).get(path)
    if (!sha) return null
    const bytes = staged ? staged.bytes : await this.content.sync.blob(this.content.site, sha)

    // Thumbnails for raster images only; SVGs and files are served as they are.
    if (width && type.kind === 'image' && type.ext !== 'svg') {
      const key = `${sha}:${width}`
      let thumb = thumbs.get(key)
      if (!thumb) {
        try {
          thumb = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
            .rotate()
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer()
        } catch {
          return { bytes, type, etag: sha }
        }
        if (thumbs.size >= MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string)
        thumbs.set(key, thumb)
      }
      return { bytes: thumb, type: { ext: 'webp', mime: 'image/webp', kind: 'image' }, etag: key }
    }
    return { bytes, type, etag: sha }
  }

  isThumbWidth(w: number): w is ThumbWidth {
    return (THUMB_WIDTHS as readonly number[]).includes(w)
  }
}
