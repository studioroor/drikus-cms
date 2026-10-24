import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { type Draft, drafts, users } from '../db/schema'
import { gitBlobSha } from '../github/sha'
import type { LinkedSite, SiteSync } from '../github/sync'
import { type Collection, type Config, type ConfigIssue, parseConfig, siteLocales } from './config'
import { checkFields, entryTitle, type FieldIssue } from './fields'
import { type Data, parseDocument, serializeDocument } from './format'
import { findSiteIcon, iconType, MAX_ICON_BYTES } from './icon'
import { entryForPath, entryPathFor, renderSlug, SINGLETON_SLUG } from './paths'

export const CONFIG_PATHS = ['.drikus/config.yml', '.drikus/config.yaml', '.drikus/config.json']

export type ContentErrorCode =
  | 'no_config'
  | 'invalid_config'
  | 'not_found'
  | 'invalid_input'
  | 'invalid_file'
  | 'slug_required'
  | 'cannot_create'
  | 'cannot_delete'
  | 'file_too_large'
  | 'unsupported_file'
  | 'invalid_image'
  | 'nothing_to_publish'
  | 'publish_blocked'
  | 'publish_in_progress'

export class ContentError extends Error {
  constructor(
    readonly code: ContentErrorCode,
    readonly status: 400 | 404 | 409,
    readonly issues?: FieldIssue[] | ConfigIssue[] | PublishProblem[],
  ) {
    super(code)
  }
}

export type PublishProblem =
  | {
      kind: 'required'
      collection: string
      slug: string
      title: string | null
      /** The language whose fields are missing, for translated collections. */
      locale: string | null
      fields: string[]
    }
  | {
      kind: 'conflict' | 'config'
      collection: string
      slug: string
      title: string | null
      locale: string | null
    }

export type ConfigState =
  | { status: 'ok'; config: Config; path: string }
  | { status: 'no_config' }
  | { status: 'invalid_config'; path: string; issues: ConfigIssue[] }

export type EntryStatus = 'published' | 'new' | 'modified' | 'deleted'

/** Parsed configs by blob SHA: the same file content always parses the same way. */
const configCache = new Map<string, ReturnType<typeof parseConfig>>()

const READ_CONCURRENCY = 8

async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker))
  return out
}
/** The top-level values the entry list sorts and shows: the sort field and all date fields. */
function listedValues(collection: Collection, data: Data | null): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (!data) return values
  for (const f of collection.fields) {
    if (f.name !== collection.sortBy && f.type !== 'date' && f.type !== 'datetime') continue
    if (data[f.name] !== undefined) values[f.name] = data[f.name]
  }
  return values
}

/**
 * Content of one site: the published files at the branch head, overlaid with
 * the site's drafts. All paths are derived from the config on the server;
 * clients only ever send collection names and slugs.
 */
export class ContentService {
  #files: Map<string, string> | undefined

  constructor(
    readonly db: Db,
    readonly sync: SiteSync,
    readonly site: LinkedSite,
  ) {}

  /** Forgets the cached head and tree, so the next read sees the branch as it is now. */
  async refresh() {
    await this.sync.head(this.site, { fresh: true })
    this.#files = undefined
  }

  /** Blob SHAs by path at the current head. */
  async files(): Promise<Map<string, string>> {
    if (this.#files) return this.#files
    const head = await this.sync.head(this.site)
    const tree = await this.sync.tree(this.site, head.treeSha)
    this.#files = new Map(tree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
    return this.#files
  }

  async #text(sha: string) {
    return (await this.sync.blob(this.site, sha)).toString('utf8')
  }

  async configState(): Promise<ConfigState> {
    const files = await this.files()
    const path = CONFIG_PATHS.find((p) => files.has(p))
    if (!path) return { status: 'no_config' }
    const sha = files.get(path) as string
    let result = configCache.get(sha)
    if (!result) {
      result = parseConfig(await this.#text(sha), path)
      configCache.set(sha, result)
    }
    return result.ok
      ? { status: 'ok', config: result.config, path }
      : { status: 'invalid_config', path, issues: result.issues }
  }

  /**
   * The site's icon at the current head: the config's `icon` when it points at
   * an image, otherwise the best guess from the repository's files.
   */
  async icon(): Promise<{ sha: string; type: string } | null> {
    const head = await this.sync.head(this.site)
    const { entries } = await this.sync.tree(this.site, head.treeSha)
    const state = await this.configState()
    const configured =
      state.status === 'ok' && state.config.icon
        ? entries.find((e) => e.type === 'blob' && e.path === state.config.icon)
        : undefined
    const entry =
      configured && iconType(configured.path) && (configured.size ?? 0) <= MAX_ICON_BYTES
        ? configured
        : findSiteIcon(entries)
    return entry ? { sha: entry.sha, type: iconType(entry.path) as string } : null
  }

  async config(): Promise<Config> {
    const state = await this.configState()
    if (state.status === 'no_config') throw new ContentError('no_config', 409)
    if (state.status === 'invalid_config')
      throw new ContentError('invalid_config', 409, state.issues)
    return state.config
  }

  async collection(name: string): Promise<Collection> {
    const collection = (await this.config()).collections.find((c) => c.name === name)
    if (!collection) throw new ContentError('not_found', 404)
    return collection
  }

  drafts(collection?: string): Draft[] {
    return this.db
      .select()
      .from(drafts)
      .where(
        collection
          ? and(eq(drafts.siteId, this.site.id), eq(drafts.collection, collection))
          : eq(drafts.siteId, this.site.id),
      )
      .all()
  }

  #draft(path: string): Draft | undefined {
    return this.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.siteId, this.site.id), eq(drafts.path, path)))
      .get()
  }

  async #published(
    collection: Collection,
    path: string,
  ): Promise<{ sha: string; data: Data } | null> {
    const sha = (await this.files()).get(path)
    if (!sha) return null
    try {
      return { sha, data: parseDocument(collection.format, await this.#text(sha)) }
    } catch (err) {
      throw new ContentError('invalid_file', 409, [
        { path, code: 'invalid', message: (err as Error).message },
      ])
    }
  }

  /**
   * The language to work in: null for untranslated collections, otherwise the
   * requested language (which must be one of the site's) or the main language.
   */
  async #locale(collection: Collection, requested?: string | null): Promise<string | null> {
    if (!collection.translation) return null
    const site = siteLocales(await this.config())
    if (!site) throw new ContentError('not_found', 404)
    if (!requested) return site.main
    if (!site.locales.includes(requested)) throw new ContentError('not_found', 404)
    return requested
  }

  /** The languages an entry has files for: every site language, or [null] if untranslated. */
  async #fileLocales(collection: Collection): Promise<(string | null)[]> {
    if (collection.translation !== 'files' && collection.translation !== 'suffix') return [null]
    return siteLocales(await this.config())?.locales ?? [null]
  }

  async #resolve(collection: Collection, slug: string, locale: string | null = null) {
    const path = entryPathFor(collection, slug, new Set((await this.files()).keys()), locale)
    if (!path) throw new ContentError('not_found', 404)
    return path
  }

  /** One file of an entry: its published version, its draft, and the data as edited. */
  async #doc(collection: Collection, slug: string, locale: string | null): Promise<Doc> {
    const path = await this.#resolve(collection, slug, locale)
    const draft = this.#draft(path)
    const published = await this.#published(collection, path)
    const data =
      draft?.action === 'upsert' ? (draft.data ?? {}) : draft ? null : (published?.data ?? null)
    return { locale, path, draft, published, data }
  }

  /** All files of an entry: one per language for per-language files, otherwise one. */
  async #docs(collection: Collection, slug: string, locale: string | null) {
    const locales = await this.#fileLocales(collection)
    return Promise.all(
      locales.map((l) =>
        this.#doc(collection, slug, l ?? (collection.translation ? locale : null)),
      ),
    )
  }

  #editor(draft: Draft | undefined) {
    return draft?.updatedBy
      ? (this.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, draft.updatedBy))
          .get() ?? null)
      : null
  }

  async listEntries(name: string) {
    const collection = await this.collection(name)
    if (!collection.folder) throw new ContentError('not_found', 404)
    const files = await this.files()
    const locales = siteLocales(await this.config())?.locales ?? []
    const main = locales[0] ?? null

    // Group files and drafts by slug, then by language (null when untranslated).
    const bySlug = new Map<
      string,
      Map<string | null, { path: string; sha?: string; draft?: Draft }>
    >()
    const slot = (slug: string, locale: string | null, path: string) => {
      let docs = bySlug.get(slug)
      if (!docs) {
        docs = new Map()
        bySlug.set(slug, docs)
      }
      let doc = docs.get(locale)
      if (!doc) {
        doc = { path }
        docs.set(locale, doc)
      }
      return doc
    }
    for (const [path, sha] of files) {
      const entry = entryForPath(collection, path, locales)
      if (entry) slot(entry.slug, entry.locale, path).sha = sha
    }
    for (const draft of this.drafts(name)) slot(draft.slug, draft.locale, draft.path).draft = draft

    const entries = await mapLimit([...bySlug.entries()], async ([slug, docs]) => {
      const states = await Promise.all(
        [...docs.entries()].map(async ([locale, d]) => {
          let data: Data | null = null
          let invalid = false
          if (d.draft?.action === 'upsert') data = d.draft.data ?? {}
          else if (d.sha && !d.draft) {
            try {
              data = parseDocument(collection.format, await this.#text(d.sha))
            } catch {
              invalid = true
            }
          }
          const status: EntryStatus = !d.draft
            ? 'published'
            : d.draft.action === 'delete'
              ? 'deleted'
              : d.sha
                ? 'modified'
                : 'new'
          return { locale, data, invalid, status, updatedAt: d.draft?.updatedAt.getTime() ?? null }
        }),
      )
      // Only deletions of files that don't exist leave nothing to show.
      const shown = states.filter((s) => s.data || s.invalid || s.status === 'deleted')
      if (!shown.length) return null
      const lead =
        shown.find((s) => s.locale === main && s.data) ?? shown.find((s) => s.data) ?? shown[0]
      const statuses = shown.map((s) => s.status)
      const status: EntryStatus = statuses.every((s) => s === 'published')
        ? 'published'
        : statuses.every((s) => s === 'deleted')
          ? 'deleted'
          : statuses.every((s) => s === 'new')
            ? 'new'
            : 'modified'
      return {
        slug,
        title: lead?.data ? entryTitle(collection.fields, lead.data, collection.summary) : null,
        status,
        invalid: !!lead?.invalid,
        updatedAt: Math.max(0, ...shown.map((s) => s.updatedAt ?? 0)) || null,
        locales: collection.translation
          ? locales.map((code) => ({
              code,
              status: (shown.find((s) => s.locale === code)?.status ?? 'missing') as LocaleStatus,
            }))
          : null,
        sortValue: collection.sortBy && lead?.data ? lead.data[collection.sortBy] : undefined,
        values: listedValues(collection, lead?.data ?? null),
      }
    })

    const list = entries.filter((e) => e !== null)
    const sortKey = collection.sortBy
    const dir = collection.sortOrder === 'desc' ? -1 : 1
    list.sort((a, b) => {
      if (sortKey) {
        const av = a.sortValue
        const bv = b.sortValue
        if (av !== bv) {
          if (av === undefined || av === null) return 1
          if (bv === undefined || bv === null) return -1
          return (av < bv ? -1 : 1) * dir
        }
      }
      return (a.title ?? a.slug).localeCompare(b.title ?? b.slug)
    })
    return list.map(({ sortValue: _, ...rest }) => rest)
  }

  /** Status of one language section in a data file with all languages. */
  #sectionStatus(doc: Doc, locale: string): LocaleStatus {
    const live = doc.published?.data[locale]
    if (!doc.draft) return live ? 'published' : 'missing'
    if (doc.draft.action === 'delete') return 'deleted'
    const edited = doc.draft.data?.[locale]
    if (!edited) return 'missing'
    if (!live) return 'new'
    return JSON.stringify(edited) === JSON.stringify(live) ? 'published' : 'modified'
  }

  async readEntry(name: string, slug: string, requested?: string | null) {
    const collection = await this.collection(name)
    const locale = await this.#locale(collection, requested)
    const shared = sharedFields(collection)
    const locales = siteLocales(await this.config())?.locales ?? []

    let doc: Doc
    let data: Data
    let status: LocaleStatus
    let localeStatuses: { code: string; status: LocaleStatus }[] | null = null

    if (collection.translation === 'sections') {
      doc = await this.#doc(collection, slug, locale)
      if (!doc.published && !doc.draft && !collection.file) throw new ContentError('not_found', 404)
      data = asObject(doc.data?.[locale as string])
      status = this.#sectionStatus(doc, locale as string)
      localeStatuses = locales.map((code) => ({ code, status: this.#sectionStatus(doc, code) }))
      if (status === 'missing') data = pick(sharedSource(doc.data, locales), shared)
    } else {
      const docs = await this.#docs(collection, slug, locale)
      doc = docs.find((d) => d.locale === locale) ?? (docs[0] as Doc)
      const exists = docs.some((d) => d.published || d.draft)
      if (!exists && !collection.file) throw new ContentError('not_found', 404)
      const statusOf = (d: Doc): LocaleStatus =>
        !d.draft
          ? d.published || !collection.translation
            ? 'published'
            : 'missing'
          : d.draft.action === 'delete'
            ? 'deleted'
            : d.published
              ? 'modified'
              : 'new'
      status = statusOf(doc)
      data = doc.data ?? {}
      if (collection.translation) {
        localeStatuses = docs.map((d) => ({ code: d.locale as string, status: statusOf(d) }))
        // A translation that doesn't exist yet starts with the shared fields filled in.
        if (status === 'missing') {
          const source =
            docs.find((d) => d.locale === locales[0] && d.data) ?? docs.find((d) => d.data)
          data = pick(source?.data ?? {}, shared)
        }
      }
    }

    return {
      collection: collection.name,
      slug,
      locale,
      locales: localeStatuses,
      data,
      status,
      published: !!doc.published,
      draft: doc.draft
        ? { updatedAt: doc.draft.updatedAt.getTime(), updatedBy: this.#editor(doc.draft) }
        : null,
      issues: checkFields(collection.fields, data),
    }
  }

  #validate(collection: Collection, data: Data) {
    const issues = checkFields(collection.fields, data)
    const invalid = issues.filter((i) => i.code === 'invalid')
    if (invalid.length) throw new ContentError('invalid_input', 400, invalid)
    return issues
  }

  /** Overlays the configured fields from `data` on top of `base`, keeping unknown keys. */
  #merge(collection: Collection, base: Data, data: Data): Data {
    const merged: Data = { ...base }
    for (const field of collection.fields) merged[field.name] = data[field.name]
    return merged
  }

  #upsertDraft(row: Omit<Draft, 'createdAt' | 'updatedAt'>) {
    const now = new Date()
    this.db
      .insert(drafts)
      .values({ ...row, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [drafts.siteId, drafts.path],
        set: {
          action: row.action,
          data: row.data,
          content: row.content,
          baseSha: row.baseSha,
          locale: row.locale,
          updatedBy: row.updatedBy,
          updatedAt: now,
        },
      })
      .run()
  }

  #deleteDraft(path: string) {
    this.db
      .delete(drafts)
      .where(and(eq(drafts.siteId, this.site.id), eq(drafts.path, path)))
      .run()
  }

  /** Stores new data for one file as a draft, or drops the draft when it matches GitHub again. */
  async #write(
    collection: Collection,
    slug: string,
    doc: Doc,
    data: Data,
    userId: string,
  ): Promise<EntryStatus> {
    const content = serializeDocument(collection.format, data)
    if (doc.published && content === (await this.#text(doc.published.sha))) {
      this.#deleteDraft(doc.path)
      return 'published'
    }
    this.#upsertDraft({
      siteId: this.site.id,
      path: doc.path,
      collection: collection.name,
      slug,
      locale: collection.translation === 'sections' ? null : doc.locale,
      action: 'upsert',
      data,
      content,
      baseSha: doc.draft ? doc.draft.baseSha : (doc.published?.sha ?? null),
      updatedBy: userId,
    })
    return doc.published ? 'modified' : 'new'
  }

  async saveDraft(
    name: string,
    slug: string,
    data: Data,
    userId: string,
    requested?: string | null,
  ) {
    const collection = await this.collection(name)
    const locale = await this.#locale(collection, requested)
    const shared = sharedFields(collection)
    const issues = this.#validate(collection, data)

    if (collection.translation === 'sections') {
      const doc = await this.#doc(collection, slug, locale)
      if (!doc.published && !doc.draft && !collection.file) throw new ContentError('not_found', 404)
      const base = doc.data ?? {}
      const section = this.#merge(collection, asObject(base[locale as string]), data)
      const full: Data = { ...base, [locale as string]: section }
      // Shared fields are the same in every language section that exists.
      for (const other of siteLocales(await this.config())?.locales ?? []) {
        if (other !== locale && full[other] && typeof full[other] === 'object') {
          full[other] = { ...asObject(full[other]), ...pick(section, shared) }
        }
      }
      return { status: await this.#write(collection, slug, doc, full, userId), issues }
    }

    const docs = await this.#docs(collection, slug, locale)
    const doc = docs.find((d) => d.locale === locale) ?? (docs[0] as Doc)
    if (!docs.some((d) => d.published || d.draft) && !collection.file) {
      throw new ContentError('not_found', 404)
    }
    const merged = this.#merge(collection, doc.published?.data ?? {}, data)
    const status = await this.#write(collection, slug, doc, merged, userId)

    // Keep shared fields identical in the other languages' files.
    if (shared.length) {
      const values = pick(merged, shared)
      for (const other of docs) {
        if (other === doc || !other.data) continue
        if (shared.every((n) => JSON.stringify(other.data?.[n]) === JSON.stringify(values[n])))
          continue
        await this.#write(collection, slug, other, { ...other.data, ...values }, userId)
      }
    }
    return { status, issues }
  }

  async createEntry(name: string, data: Data, userId: string, requested?: string | null) {
    const collection = await this.collection(name)
    if (!collection.folder || !collection.create) throw new ContentError('cannot_create', 400)
    const locale = await this.#locale(collection, requested)
    this.#validate(collection, data)

    const base = renderSlug(collection.slug, data)
    if (!base) throw new ContentError('slug_required', 400)
    const files = await this.files()
    const locales = siteLocales(await this.config())?.locales ?? []
    // Compare slugs, not paths: "x.yml" and a new "x.yaml" (or another language) are the same entry.
    const taken = new Set([
      ...[...files.keys()].map((p) => entryForPath(collection, p, locales)?.slug).filter(Boolean),
      ...this.drafts(name).map((d) => d.slug),
    ])
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 110)}-${n}`
    const path = entryPathFor(collection, slug, new Set(), locale) as string
    const merged = this.#merge(collection, {}, data)
    this.#upsertDraft({
      siteId: this.site.id,
      path,
      collection: name,
      slug,
      locale,
      action: 'upsert',
      data: merged,
      content: serializeDocument(collection.format, merged),
      baseSha: null,
      updatedBy: userId,
    })
    return { slug }
  }

  /** Deletes an entry in every language. */
  async deleteEntry(name: string, slug: string, userId: string) {
    const collection = await this.collection(name)
    if (!collection.folder || !collection.delete) throw new ContentError('cannot_delete', 400)
    const docs = await this.#docs(collection, slug, await this.#locale(collection))
    if (!docs.some((d) => d.published || d.draft)) throw new ContentError('not_found', 404)
    let deleted = false
    for (const doc of docs) {
      if (doc.published) {
        deleted = true
        this.#upsertDraft({
          siteId: this.site.id,
          path: doc.path,
          collection: name,
          slug,
          locale: doc.locale,
          action: 'delete',
          data: null,
          content: null,
          baseSha: doc.draft ? doc.draft.baseSha : doc.published.sha,
          updatedBy: userId,
        })
      } else if (doc.draft) {
        this.#deleteDraft(doc.path)
      }
    }
    return { status: deleted ? ('deleted' as const) : ('removed' as const) }
  }

  /** Throws away the entry's unpublished changes, in every language. */
  async discard(name: string, slug: string) {
    const collection = await this.collection(name)
    for (const doc of await this.#docs(collection, slug, await this.#locale(collection))) {
      this.#deleteDraft(doc.path)
    }
    return { ok: true as const }
  }

  /** Earlier versions of an entry: the commits that changed its file, newest first. */
  async revisions(name: string, slug: string, requested?: string | null) {
    const collection = await this.collection(name)
    const locale = await this.#locale(collection, requested)
    const path = await this.#resolve(collection, slug, locale)
    const commits = await this.sync.history(this.site, path)
    const draft = this.#draft(path)
    if (!commits.length && !draft) throw new ContentError('not_found', 404)
    return {
      // The newest commit holds what's live, unless the file was deleted since.
      live: (await this.files()).has(path),
      draft: draft
        ? {
            action: draft.action,
            updatedAt: draft.updatedAt.getTime(),
            updatedBy: this.#editor(draft),
          }
        : null,
      revisions: commits.map((c) => ({
        sha: c.sha,
        message: c.message.split('\n')[0] ?? '',
        authorName: c.authorName || null,
        date: Date.parse(c.date) || null,
      })),
    }
  }

  /** The entry's file in one of its revisions, or null if it was deleted there. */
  async #revisionFile(collection: Collection, slug: string, sha: string, locale: string | null) {
    const path = await this.#resolve(collection, slug, locale)
    // Only commits from the entry's own history: no peeking at arbitrary refs.
    const commits = await this.sync.history(this.site, path)
    if (!commits.some((c) => c.sha === sha)) throw new ContentError('not_found', 404)
    const content = await this.sync.fileAt(this.site, sha, path)
    if (!content) return { path, text: null, data: null }
    const text = content.toString('utf8')
    try {
      return { path, text, data: parseDocument(collection.format, text) }
    } catch (err) {
      throw new ContentError('invalid_file', 409, [
        { path, code: 'invalid', message: (err as Error).message },
      ])
    }
  }

  /** The data of one version: a commit SHA, or `draft` for the unpublished changes. */
  async readRevision(
    name: string,
    slug: string,
    rev: string,
    requested?: string | null,
  ): Promise<{ data: Data | null }> {
    const collection = await this.collection(name)
    const locale = await this.#locale(collection, requested)
    // In a data file with all languages, a version of one language is its section.
    const section = (data: Data | null) =>
      data && collection.translation === 'sections' ? asObject(data[locale as string]) : data
    if (rev === 'draft') {
      const draft = this.#draft(await this.#resolve(collection, slug, locale))
      if (!draft) throw new ContentError('not_found', 404)
      return { data: section(draft.action === 'upsert' ? (draft.data ?? {}) : null) }
    }
    return { data: section((await this.#revisionFile(collection, slug, rev, locale)).data) }
  }

  /**
   * Brings back an earlier version as a draft, byte for byte, so it goes live
   * with the next publish like any other change. For a data file with all
   * languages, that restores every language.
   */
  async restoreRevision(
    name: string,
    slug: string,
    sha: string,
    userId: string,
    requested?: string | null,
  ) {
    const collection = await this.collection(name)
    const locale = await this.#locale(collection, requested)
    const { path, text, data } = await this.#revisionFile(collection, slug, sha, locale)
    if (text === null || data === null) throw new ContentError('not_found', 404)
    const publishedSha = (await this.files()).get(path) ?? null
    if (publishedSha === gitBlobSha(text)) {
      this.#deleteDraft(path)
      return { status: 'published' as EntryStatus }
    }
    const draft = this.#draft(path)
    this.#upsertDraft({
      siteId: this.site.id,
      path,
      collection: name,
      slug,
      locale: collection.translation === 'sections' ? null : locale,
      action: 'upsert',
      data,
      content: text,
      baseSha: draft ? draft.baseSha : publishedSha,
      updatedBy: userId,
    })
    return { status: (publishedSha ? 'modified' : 'new') as EntryStatus }
  }

  /** All pending changes of the site, newest first. */
  changes() {
    return this.db
      .select({ draft: drafts, editor: { id: users.id, name: users.name } })
      .from(drafts)
      .leftJoin(users, eq(users.id, drafts.updatedBy))
      .where(eq(drafts.siteId, this.site.id))
      .all()
      .sort((a, b) => b.draft.updatedAt.getTime() - a.draft.updatedAt.getTime())
      .map(({ draft, editor }) => ({
        collection: draft.collection,
        slug: draft.slug,
        locale: draft.locale,
        action: draft.action,
        status: (draft.action === 'delete'
          ? 'deleted'
          : draft.baseSha
            ? 'modified'
            : 'new') as EntryStatus,
        title: draft.data && typeof draft.data.title === 'string' ? draft.data.title : null,
        updatedAt: draft.updatedAt.getTime(),
        updatedBy: editor?.id ? editor : null,
      }))
  }
}

interface Doc {
  locale: string | null
  path: string
  draft: Draft | undefined
  published: { sha: string; data: Data } | null
  /** The data as edited: the draft, else the published file; null if absent or being deleted. */
  data: Data | null
}

/** A language that has no file (or section) yet shows as missing. */
export type LocaleStatus = EntryStatus | 'missing'

function asObject(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {}
}

function pick(data: Data, names: string[]): Data {
  return Object.fromEntries(names.filter((n) => n in data).map((n) => [n, data[n]]))
}

/** Names of fields that are the same in every language. */
export function sharedFields(collection: Collection): string[] {
  return collection.translation
    ? collection.fields.filter((f) => f.i18n === false).map((f) => f.name)
    : []
}

/** In a data file with all languages: the section to copy shared fields from. */
function sharedSource(full: Data | null, locales: string[]): Data {
  for (const l of locales) if (full?.[l] && typeof full[l] === 'object') return full[l] as Data
  return {}
}

export { SINGLETON_SLUG }
