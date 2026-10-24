import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  // GitHub repository ID (stable across renames); linked in phase 2.
  repoId: integer('repo_id').unique(),
  repoFullName: text('repo_full_name'),
  branch: text('branch').notNull().default('main'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

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
