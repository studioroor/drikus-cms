import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export const FIELD_TYPES = [
  'string',
  'text',
  'markdown',
  'richtext',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'image',
  'file',
  'url',
  'color',
  'list',
  'object',
  'blocks',
  'reference',
  'hidden',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const FORMATS = ['md', 'mdx', 'json', 'yaml'] as const
export type Format = (typeof FORMATS)[number]

/** Folders the CMS must never write to, whatever a config says. */
const PROTECTED_ROOTS = ['.git', '.github', '.drikus']

const Name = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Use letters, digits, - and _ (not starting with a digit)')
  .max(64)

/** A label shown in the UI: one string, or one per UI language. */
const Label = z.union([
  z.string().max(200),
  z.object({ nl: z.string().max(200).optional(), en: z.string().max(200).optional() }),
])

/** A repository-relative path that cannot escape the repo or touch protected folders. */
const RepoPath = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'Only letters, digits, ., -, _ and / are allowed')
  .refine((p) => !p.startsWith('/') && !p.endsWith('/'), 'No leading or trailing slash')
  .refine(
    (p) => p.split('/').every((s) => s !== '' && s !== '.' && s !== '..'),
    'No empty, . or .. segments',
  )
  .refine(
    (p) => !PROTECTED_ROOTS.includes(p.split('/')[0] as string),
    'Paths inside .git, .github or .drikus are not allowed',
  )

/** Placeholder for the language in paths of translated collections. */
export const LOCALE_TOKEN = '{{locale}}'

/** Like RepoPath, but may contain {{locale}} (checked as if it were a language code). */
const LocalizedRepoPath = z
  .string()
  .max(300)
  .superRefine((p, ctx) => {
    const res = RepoPath.safeParse(p.replaceAll(LOCALE_TOKEN, 'xx'))
    if (!res.success)
      for (const issue of res.error.issues) ctx.addIssue({ code: 'custom', message: issue.message })
  })

/** A language code such as nl, en or pt-BR. */
const LocaleCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Use a language code like nl or en')

const OptionValue = z.union([z.string().max(200), z.number()])
const SelectOption = z.union([OptionValue, z.object({ label: Label, value: OptionValue })])

export const FieldSchema = z.object({
  name: Name,
  label: Label.optional(),
  hint: Label.optional(),
  type: z.enum(FIELD_TYPES).default('string'),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  // string / text
  maxLength: z.number().int().positive().optional(),
  // number
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  // translated collections: false = one value shared by all languages (dates, images, …)
  i18n: z.boolean().optional(),
  // select / reference
  options: z.array(SelectOption).max(500).optional(),
  multiple: z.boolean().optional(),
  // reference
  collection: Name.optional(),
  // richtext: styles to pick for an image, written after "#" in its path (photo.jpg#right)
  imageStyles: z
    .array(z.union([Name, z.object({ label: Label, value: Name })]))
    .max(20)
    .optional(),
  // list / object
  get fields() {
    return z.array(FieldSchema).max(100).optional()
  },
  get field() {
    return FieldSchema.optional()
  },
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().positive().optional(),
  // blocks
  get blocks() {
    return z.array(BlockSchema).max(50).optional()
  },
  typeKey: Name.default('type'),
})

export const BlockSchema = z.object({
  name: Name,
  label: Label.optional(),
  hint: Label.optional(),
  get fields() {
    return z.array(FieldSchema).max(100)
  },
})

export const CollectionSchema = z.object({
  name: Name,
  label: Label.optional(),
  description: Label.optional(),
  /** A folder with one file per entry (blog posts, team members, …). */
  folder: LocalizedRepoPath.optional(),
  /** A single file (homepage, site settings, …). */
  file: LocalizedRepoPath.optional(),
  /**
   * Translate this collection into the site's languages. Implied by {{locale}}
   * in the path; without it, folders use name.<locale>.md and data files hold
   * one section per language.
   */
  i18n: z.boolean().optional(),
  format: z.enum(FORMATS).optional(),
  /** Template for new entry file names, e.g. "{{year}}-{{title}}". */
  slug: z.string().max(200).default('{{title}}'),
  /** Field shown as the entry's title in lists. */
  summary: Name.optional(),
  sortBy: Name.optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  create: z.boolean().default(true),
  delete: z.boolean().default(true),
  fields: z.array(FieldSchema).min(1).max(100),
})

export const ConfigSchema = z.object({
  /** The site's content languages; the first (or `default`) is the main one. */
  i18n: z
    .object({ locales: z.array(LocaleCode).min(2).max(10), default: LocaleCode.optional() })
    .optional(),
  collections: z.array(CollectionSchema).min(1).max(100),
  /** Where uploads go and how images are processed (see docs/content-config.md). */
  media: z
    .object({
      folder: RepoPath.default('public/uploads'),
      /** URL the site serves the folder at; derived from the folder when omitted. */
      publicPath: z
        .string()
        .max(300)
        .regex(/^\/[A-Za-z0-9._\-/]*$/, 'Start with / and use letters, digits, ., -, _ and /')
        .optional(),
      /** Images wider than this are scaled down (pixels). */
      maxWidth: z.number().int().min(200).max(8000).default(2000),
      /** "webp" converts photos to WebP; "original" keeps JPEG/PNG/GIF. */
      format: z.enum(['webp', 'original']).default('webp'),
      quality: z.number().int().min(40).max(100).default(82),
      maxSizeMb: z.number().min(1).max(50).default(15),
    })
    .optional(),
  /** Image shown for the site in the CMS; found automatically when omitted. */
  icon: RepoPath.optional(),
})

export type Field = z.infer<typeof FieldSchema>
export type Block = z.infer<typeof BlockSchema>
/**
 * How a collection stores languages:
 * - files: one file per language, {{locale}} in the folder or file path
 * - suffix: folder entries named <slug>.<locale>.<ext>
 * - sections: one data file with a section per language ({ nl: {…}, en: {…} })
 */
export type Translation = 'files' | 'suffix' | 'sections'

export type Collection = z.infer<typeof CollectionSchema> & {
  format: Format
  translation: Translation | null
}
export type Config = Omit<z.infer<typeof ConfigSchema>, 'collections'> & {
  collections: Collection[]
}

export interface ConfigIssue {
  path: string
  message: string
}

const EXTENSION_FORMATS: Record<string, Format> = {
  md: 'md',
  markdown: 'md',
  mdx: 'mdx',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
}

export function formatForPath(path: string): Format | undefined {
  return EXTENSION_FORMATS[path.split('.').pop()?.toLowerCase() ?? '']
}

/** Rules a schema can't express: unique names, required companions, cross-references. */
function semanticIssues(config: z.infer<typeof ConfigSchema>): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })
  const collections = new Map(config.collections.map((c) => [c.name, c]))
  if (config.i18n) {
    const { locales, default: main } = config.i18n
    if (new Set(locales).size !== locales.length) add('i18n.locales', 'Languages must be unique')
    if (main && !locales.includes(main))
      add('i18n.default', `"${main}" is not one of the languages`)
  }

  function checkFields(fields: Field[], at: string) {
    const seen = new Set<string>()
    fields.forEach((f, i) => {
      const p = `${at}.${i}`
      if (seen.has(f.name)) add(`${p}.name`, `Duplicate field name "${f.name}"`)
      seen.add(f.name)
      if (f.type === 'select' && !f.options?.length) add(p, 'A select field needs options')
      if (f.type === 'list' && !f.fields === !f.field) {
        add(p, 'A list field needs either "fields" (list of objects) or "field" (list of values)')
      }
      if (f.type === 'object' && !f.fields?.length) add(p, 'An object field needs fields')
      if (f.type === 'blocks') {
        if (!f.blocks?.length) add(p, 'A blocks field needs blocks')
        const names = new Set<string>()
        f.blocks?.forEach((b, j) => {
          if (names.has(b.name)) add(`${p}.blocks.${j}.name`, `Duplicate block name "${b.name}"`)
          names.add(b.name)
          if (b.fields.some((bf) => bf.name === f.typeKey)) {
            add(`${p}.blocks.${j}`, `Block fields can't use the reserved name "${f.typeKey}"`)
          }
          checkFields(b.fields, `${p}.blocks.${j}.fields`)
        })
      }
      if (f.type === 'reference') {
        const target = f.collection && collections.get(f.collection)
        if (!target) add(p, 'A reference field needs "collection" naming another collection')
        else if (!target.folder) add(p, `Collection "${f.collection}" is not a folder collection`)
      }
      if (f.fields) checkFields(f.fields, `${p}.fields`)
      if (f.field) checkFields([f.field], `${p}.field`)
    })
  }

  const names = new Set<string>()
  const paths = new Set<string>()
  config.collections.forEach((c, i) => {
    const p = `collections.${i}`
    if (names.has(c.name)) add(`${p}.name`, `Duplicate collection name "${c.name}"`)
    names.add(c.name)
    if (!c.folder === !c.file) add(p, 'Set either "folder" or "file"')
    const location = c.folder ?? c.file
    if (location) {
      if (paths.has(location)) add(p, `"${location}" is used by more than one collection`)
      paths.add(location)
    }
    if (c.file) {
      const fmt = formatForPath(c.file)
      if (!fmt) add(`${p}.file`, 'Use a .md, .mdx, .json, .yaml or .yml file')
      else if (c.format && c.format !== fmt) add(`${p}.format`, `Doesn't match the file extension`)
    }
    const translation = translationFor(c)
    const hasToken = (c.folder ?? c.file ?? '').includes(LOCALE_TOKEN)
    if (hasToken && c.i18n === false)
      add(`${p}.i18n`, 'Remove {{locale}} from the path or set i18n: true')
    if (translation && !config.i18n) {
      add(p, 'Translated collections need the site languages: add i18n: { locales: [nl, en] }')
    }
    if (
      translation === 'sections' &&
      (c.format === 'md' || c.file?.match(/\.(md|mdx|markdown)$/))
    ) {
      add(
        `${p}.file`,
        'A Markdown file holds one language: put {{locale}} in the path, e.g. pages/{{locale}}/about.md',
      )
    }
    if (translation === 'files' && c.file && !c.file.includes(LOCALE_TOKEN)) {
      add(`${p}.file`, 'Put {{locale}} in the file path')
    }
    const top = new Set(c.fields.map((f) => f.name))
    if (c.summary && !top.has(c.summary)) add(`${p}.summary`, `Unknown field "${c.summary}"`)
    if (c.sortBy && !top.has(c.sortBy)) add(`${p}.sortBy`, `Unknown field "${c.sortBy}"`)
    const body = c.fields.find((f) => f.name === 'body')
    const format = c.format ?? (c.file ? formatForPath(c.file) : 'md')
    if (
      body &&
      (format === 'md' || format === 'mdx') &&
      !['text', 'markdown', 'richtext'].includes(body.type)
    ) {
      add(
        `${p}.fields`,
        'In Markdown files "body" is the page content: use type text, markdown or richtext',
      )
    }
    checkFields(c.fields, `${p}.fields`)
  })
  return issues
}

function translationFor(c: z.infer<typeof CollectionSchema>): Translation | null {
  if ((c.folder ?? c.file ?? '').includes(LOCALE_TOKEN)) return 'files'
  if (!c.i18n) return null
  return c.folder ? 'suffix' : 'sections'
}

/** The site's languages, main language first; null for single-language sites. */
export function siteLocales(config: Config): { locales: string[]; main: string } | null {
  if (!config.i18n) return null
  const main = config.i18n.default ?? (config.i18n.locales[0] as string)
  return { locales: [main, ...config.i18n.locales.filter((l) => l !== main)], main }
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; issues: ConfigIssue[] }

/** Parses `.drikus/config.yml` (or .json). Never executes anything from the repository. */
export function parseConfig(source: string, path = '.drikus/config.yml'): ConfigResult {
  let raw: unknown
  try {
    raw = path.endsWith('.json') ? JSON.parse(source) : parseYaml(source, { maxAliasCount: 50 })
  } catch (err) {
    return { ok: false, issues: [{ path: '', message: `Syntax error: ${(err as Error).message}` }] }
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }
  }
  const issues = semanticIssues(parsed.data)
  if (issues.length) return { ok: false, issues }
  const collections = parsed.data.collections.map((c) => ({
    ...c,
    format: c.format ?? (c.file ? (formatForPath(c.file) as Format) : 'md'),
    translation: translationFor(c),
  }))
  return { ok: true, config: { ...parsed.data, collections } }
}

/** JSON Schema for editor autocomplete (`# yaml-language-server: $schema=…`). */
export function configJsonSchema() {
  return z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' })
}
