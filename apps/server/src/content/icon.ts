import type { TreeEntry } from '../db/schema'

export const ICON_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
} as const

/** Larger files are almost certainly not an icon (and not worth caching). */
export const MAX_ICON_BYTES = 512 * 1024

/**
 * File names worth showing as a site's icon, best first. Square icons beat
 * logos (often wide wordmarks), and vector beats raster beats .ico.
 */
const NAMES: RegExp[] = [
  /^favicon\.svg$/,
  /^(app-)?icon\.svg$/,
  /^apple-touch-icon(-precomposed)?\.png$/,
  /^(android-chrome|icon)-512x512\.png$/,
  /^(android-chrome|icon)-192x192\.png$/,
  /^(app-)?icon\.(png|webp)$/,
  /^favicon(-\d+x\d+)?\.png$/,
  /^logo(-?mark|-?icon|-square)?\.svg$/,
  /^logo(-?mark|-?icon|-square)?\.(png|webp)$/,
  /^favicon\.ico$/,
  /^logo\.(jpe?g)$/,
]

/** Folders that hold dependencies, build output or test data rather than the site's own files. */
const SKIP = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.astro',
  '.svelte-kit',
  '.vercel',
  'coverage',
  'fixtures',
  '__tests__',
  '__mocks__',
  '.git',
])

/** Where frameworks keep public files; a match here wins over the same name elsewhere. */
const PUBLIC_DIRS = /(^|\/)(public|static|app|src\/app|assets|src\/assets|images|img)$/

export function iconType(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return ICON_TYPES[ext as keyof typeof ICON_TYPES] ?? null
}

/** Picks the file in the repo tree most likely to be the site's icon, or null. */
export function findSiteIcon(entries: TreeEntry[]): TreeEntry | null {
  let best: { entry: TreeEntry; score: number } | null = null
  for (const entry of entries) {
    if (entry.type !== 'blob' || (entry.size ?? 0) > MAX_ICON_BYTES) continue
    const segments = entry.path.split('/')
    const name = (segments.pop() as string).toLowerCase()
    const rank = NAMES.findIndex((re) => re.test(name))
    if (rank === -1 || segments.some((s) => SKIP.has(s.toLowerCase()))) continue
    const dir = segments.join('/')
    // Name matters most, then a public folder, then how close to the root it is.
    const score = rank * 100 + (PUBLIC_DIRS.test(dir) ? 0 : 50) + segments.length
    if (!best || score < best.score || (score === best.score && entry.path < best.entry.path)) {
      best = { entry, score }
    }
  }
  return best?.entry ?? null
}
