import { and, eq, ne } from 'drizzle-orm'
import type { Db } from '../db'
import { sessions, type User, users } from '../db/schema'
import { randomToken, sha256 } from '../lib/crypto'

const DAY = 24 * 60 * 60 * 1000
export const SESSION_IDLE_MS = 14 * DAY
export const SESSION_ABSOLUTE_MS = 30 * DAY
const TOUCH_INTERVAL_MS = 60 * 1000

export interface SessionMeta {
  ip?: string | null
  userAgent?: string | null
}

export function createSession(db: Db, userId: string, meta: SessionMeta = {}) {
  const token = randomToken()
  const now = Date.now()
  db.insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_ABSOLUTE_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .run()
  return token
}

export function validateSession(db: Db, token: string): { user: User; tokenHash: string } | null {
  const tokenHash = sha256(token)
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .get()
  if (!row) return null

  const now = Date.now()
  const expired =
    row.session.expiresAt.getTime() <= now ||
    row.session.lastSeenAt.getTime() + SESSION_IDLE_MS <= now ||
    row.user.disabledAt !== null
  if (expired) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run()
    return null
  }

  if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    db.update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.tokenHash, tokenHash))
      .run()
  }
  return { user: row.user, tokenHash }
}

export function revokeSession(db: Db, tokenHash: string) {
  db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run()
}

/** Revokes all sessions of a user, optionally keeping the current one. */
export function revokeUserSessions(db: Db, userId: string, keepTokenHash?: string) {
  db.delete(sessions)
    .where(
      keepTokenHash
        ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash))
        : eq(sessions.userId, userId),
    )
    .run()
}
