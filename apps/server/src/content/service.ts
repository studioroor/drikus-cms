import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { type Draft, drafts, users } from '../db/schema'
import type { LinkedSite, SiteSync } from '../github/sync'
import { type Collection, type Config, type ConfigIssue, parseConfig } from './config'
import { checkFields, entryTitle, type FieldIssue } from './fields'
import { type Data, parseDocument, serializeDocument } from './format'
import { entryPathFor, renderSlug, SINGLETON_SLUG, slugForPath } from './paths'

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
  | { kind: 'required'; collection: string; slug: string; title: string | null; fields: string[] }
  | { kind: 'conflict' | 'config'; collection: string; slug: string; title: string | null }

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

  async #resolve(collection: Collection, slug: string) {
    const path = entryPathFor(collection, slug, new Set((await this.files()).keys()))
    if (!path) throw new ContentError('not_found', 404)
    return path
  }

  async listEntries(name: string) {
    const collection = await this.collection(name)
    if (!collection.folder) throw new ContentError('not_found', 404)
    const files = await this.files()
    const draftByPath = new Map(this.drafts(name).map((d) => [d.path, d]))

    const published = [...files.entries()]
      .map(([path, sha]) => ({ path, sha, slug: slugForPath(collection, path) }))
      .filter((f): f is { path: string; sha: string; slug: string } => f.slug !== null)

    const entries = await mapLimit(published, async (f) => {
      const draft = draftByPath.get(f.path)
      draftByPath.delete(f.path)
      let data: Data | null = null
      let invalid = false
      if (draft?.action === 'upsert') data = draft.data ?? {}
      else {
        try {
          data = parseDocument(collection.format, await this.#text(f.sha))
        } catch {
          invalid = true
        }
      }
      const status: EntryStatus = !draft
        ? 'published'
        : draft.action === 'delete'
          ? 'deleted'
          : 'modified'
      return { slug: f.slug, data, status, invalid, draft } as {
        slug: string
        data: Data | null
        status: EntryStatus
        invalid: boolean
        draft: Draft | undefined
      }
    })
    // Drafts for files that don't exist yet are new entries.
    for (const draft of draftByPath.values()) {
      if (draft.action === 'upsert') {
        entries.push({
          slug: draft.slug,
          data: draft.data ?? {},
          status: 'new',
          invalid: false,
          draft,
        })
      }
    }

    const sortKey = collection.sortBy
    const list = entries.map((e) => ({
      slug: e.slug,
      title: e.data ? entryTitle(collection.fields, e.data, collection.summary) : null,
      status: e.status,
      invalid: e.invalid,
      updatedAt: e.draft?.updatedAt.getTime() ?? null,
      sortValue: sortKey && e.data ? e.data[sortKey] : undefined,
    }))
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

  async readEntry(name: string, slug: string) {
    const collection = await this.collection(name)
    const path = await this.#resolve(collection, slug)
    const draft = this.#draft(path)
    const published = await this.#published(collection, path)
    if (!published && !draft && !collection.file) throw new ContentError('not_found', 404)

    const data = draft?.action === 'upsert' ? (draft.data ?? {}) : (published?.data ?? {})
    const status: EntryStatus = !draft
      ? 'published'
      : draft.action === 'delete'
        ? 'deleted'
        : published
          ? 'modified'
          : 'new'
    const editor = draft?.updatedBy
      ? this.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, draft.updatedBy))
          .get()
      : undefined
    return {
      collection: collection.name,
      slug,
      data,
      status,
      published: !!published,
      draft: draft ? { updatedAt: draft.updatedAt.getTime(), updatedBy: editor ?? null } : null,
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

  async saveDraft(name: string, slug: string, data: Data, userId: string) {
    const collection = await this.collection(name)
    const path = await this.#resolve(collection, slug)
    const draft = this.#draft(path)
    const published = await this.#published(collection, path)
    if (!published && !draft && !collection.file) throw new ContentError('not_found', 404)

    const issues = this.#validate(collection, data)
    const merged = this.#merge(collection, published?.data ?? {}, data)
    const content = serializeDocument(collection.format, merged)

    // Saving the published content again simply means "no changes".
    if (published && content === (await this.#text(published.sha))) {
      this.#deleteDraft(path)
      return { status: 'published' as EntryStatus, issues }
    }
    this.#upsertDraft({
      siteId: this.site.id,
      path,
      collection: name,
      slug,
      action: 'upsert',
      data: merged,
      content,
      baseSha: draft ? draft.baseSha : (published?.sha ?? null),
      updatedBy: userId,
    })
    return { status: (published ? 'modified' : 'new') as EntryStatus, issues }
  }

  async createEntry(name: string, data: Data, userId: string) {
    const collection = await this.collection(name)
    if (!collection.folder || !collection.create) throw new ContentError('cannot_create', 400)
    this.#validate(collection, data)

    const base = renderSlug(collection.slug, data)
    if (!base) throw new ContentError('slug_required', 400)
    const files = await this.files()
    // Compare slugs, not paths: "x.yml" and a new "x.yaml" would be the same entry.
    const taken = new Set([
      ...[...files.keys()].map((p) => slugForPath(collection, p)).filter((s) => s !== null),
      ...this.drafts(name).map((d) => d.slug),
    ])
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 110)}-${n}`
    const path = entryPathFor(collection, slug, new Set()) as string
    const merged = this.#merge(collection, {}, data)
    this.#upsertDraft({
      siteId: this.site.id,
      path,
      collection: name,
      slug,
      action: 'upsert',
      data: merged,
      content: serializeDocument(collection.format, merged),
      baseSha: null,
      updatedBy: userId,
    })
    return { slug }
  }

  async deleteEntry(name: string, slug: string, userId: string) {
    const collection = await this.collection(name)
    if (!collection.folder || !collection.delete) throw new ContentError('cannot_delete', 400)
    const path = await this.#resolve(collection, slug)
    const publishedSha = (await this.files()).get(path)
    const draft = this.#draft(path)
    if (!publishedSha) {
      if (!draft) throw new ContentError('not_found', 404)
      this.#deleteDraft(path)
      return { status: 'removed' as const }
    }
    this.#upsertDraft({
      siteId: this.site.id,
      path,
      collection: name,
      slug,
      action: 'delete',
      data: null,
      content: null,
      baseSha: draft ? draft.baseSha : publishedSha,
      updatedBy: userId,
    })
    return { status: 'deleted' as const }
  }

  async discard(name: string, slug: string) {
    const collection = await this.collection(name)
    const path = await this.#resolve(collection, slug)
    this.#deleteDraft(path)
    return { ok: true as const }
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

export { SINGLETON_SLUG }
