import { sql } from 'drizzle-orm'
import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`)

export const ROLES = ['superadmin', 'editor'] as const
export type Role = (typeof ROLES)[number]

export const LOCALES = ['nl', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // Null until the user has accepted their invite and chosen a password.
  passwordHash: text('password_hash'),
  role: text('role', { enum: ROLES }).notNull().default('editor'),
  locale: text('locale', { enum: LOCALES }).notNull().default('nl'),
  // TOTP secrets are encrypted at rest (see lib/crypto.ts).
  totpSecretEnc: text('totp_secret_enc'),
  totpPendingEnc: text('totp_pending_enc'),
  // Last accepted TOTP time step, to prevent code replay.
  totpLastStep: integer('totp_last_step'),
  disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

export const sessions = sqliteTable(
  'sessions',
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const AUTH_TOKEN_TYPES = ['invite', 'reset', 'setup'] as const
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number]

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    type: text('type', { enum: AUTH_TOKEN_TYPES }).notNull(),
    // Null only for the first-run setup token.
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
)

export const sites = sqliteTable('sites', {
  id: id(),
  name: text('name').notNull(),
  siteUrl: text('site_url'),
  description: text('description'),
  // GitHub repository ID: stable across renames, so it's the real link.
  repoId: integer('repo_id').unique(),
  // Cached `owner/name`, refreshed from GitHub when the repo is renamed.
  repoFullName: text('repo_full_name'),
  branch: text('branch').notNull().default('main'),
  // Last known head of `branch`, kept fresh by webhooks or short-lived checks.
  headSha: text('head_sha'),
  headTreeSha: text('head_tree_sha'),
  headCheckedAt: integer('head_checked_at', { mode: 'timestamp_ms' }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

/** Git trees by SHA. Content-addressed, so entries never go stale. */
export const gitTrees = sqliteTable('git_trees', {
  sha: text('sha').primaryKey(),
  entries: text('entries', { mode: 'json' }).notNull().$type<TreeEntry[]>(),
  truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestamp('created_at'),
})

/** Git blobs (file contents) by SHA. Content-addressed and immutable. */
export const gitBlobs = sqliteTable('git_blobs', {
  sha: text('sha').primaryKey(),
  content: blob('content', { mode: 'buffer' }).notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at'),
})

export const DRAFT_ACTIONS = ['upsert', 'delete'] as const
export type DraftAction = (typeof DRAFT_ACTIONS)[number]

/**
 * Unpublished changes, one row per file. Shared by everyone editing the site
 * (last save wins). Publishing turns all of a site's drafts into one commit.
 */
export const drafts = sqliteTable(
  'drafts',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    collection: text('collection').notNull(),
    slug: text('slug').notNull(),
    action: text('action', { enum: DRAFT_ACTIONS }).notNull(),
    // Structured data as edited (null for deletions).
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    // The serialized file content to commit (null for deletions).
    content: text('content'),
    // Blob SHA of the published file the draft started from; null for new files.
    baseSha: text('base_sha'),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.path] })],
)

export type Draft = typeof drafts.$inferSelect

/**
 * Uploaded files waiting to be published. They're committed together with
 * the drafts on the next publish, then removed from here.
 */
export const stagedMedia = sqliteTable(
  'staged_media',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    bytes: blob('bytes', { mode: 'buffer' }).notNull(),
    size: integer('size').notNull(),
    kind: text('kind', { enum: ['image', 'file'] }).notNull(),
    width: integer('width'),
    height: integer('height'),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.path] })],
)

export type StagedMedia = typeof stagedMedia.$inferSelect

export const DEPLOY_STATES = ['pending', 'success', 'failure', 'none', 'unknown'] as const
export type DeployState = (typeof DEPLOY_STATES)[number]

export interface PublishedChange {
  collection: string
  slug: string
  path: string
  status: 'new' | 'modified' | 'deleted'
  title: string | null
}

/** One row per publish: the commit it made and the deploy state of that commit. */
export const publishes = sqliteTable(
  'publishes',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    commitSha: text('commit_sha').notNull(),
    message: text('message').notNull(),
    changes: text('changes', { mode: 'json' }).notNull().$type<PublishedChange[]>(),
    // Cached once final (success/failure/none); pending states are re-checked.
    deployState: text('deploy_state', { enum: DEPLOY_STATES }).notNull().default('pending'),
    deployCheckedAt: integer('deploy_checked_at', { mode: 'timestamp_ms' }),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('publishes_site_idx').on(t.siteId, t.createdAt)],
)

export type Publish = typeof publishes.$inferSelect

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export const siteMembers = sqliteTable(
  'site_members',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.userId] }),
    index('site_members_user_idx').on(t.userId),
  ],
)

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: timestamp('at'),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
)

export type User = typeof users.$inferSelect
export type Site = typeof sites.$inferSelect
