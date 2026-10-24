import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import { type AuthTokenType, authTokens, type User, users } from '../db/schema'
import { randomToken, sha256 } from '../lib/crypto'

const HOUR = 60 * 60 * 1000
export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  invite: 72 * HOUR,
  reset: 24 * HOUR,
  setup: 24 * HOUR,
}

export function createAuthToken(
  db: Db,
  opts: { type: AuthTokenType; userId?: string | null; createdBy?: string | null },
) {
  const token = randomToken()
  db.transaction((tx) => {
    // Only the newest link of a given type works for a user.
    if (opts.userId) {
      tx.delete(authTokens)
        .where(
          and(
            eq(authTokens.userId, opts.userId),
            eq(authTokens.type, opts.type),
            isNull(authTokens.usedAt),
          ),
        )
        .run()
    } else {
      tx.delete(authTokens).where(eq(authTokens.type, opts.type)).run()
    }
    tx.insert(authTokens)
      .values({
        tokenHash: sha256(token),
        type: opts.type,
        userId: opts.userId ?? null,
        createdBy: opts.createdBy ?? null,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS[opts.type]),
      })
      .run()
  })
  return token
}

export interface ValidToken {
  id: string
  type: AuthTokenType
  user: User | null
}

export function findValidToken(db: Db, token: string): ValidToken | null {
  const row = db
    .select({ token: authTokens, user: users })
    .from(authTokens)
    .leftJoin(users, eq(users.id, authTokens.userId))
    .where(eq(authTokens.tokenHash, sha256(token)))
    .get()
  if (!row || row.token.usedAt || row.token.expiresAt.getTime() <= Date.now()) return null
  if (row.token.type !== 'setup' && (!row.user || row.user.disabledAt)) return null
  return { id: row.token.id, type: row.token.type, user: row.user }
}

/** Marks a token as used; returns false if it was already consumed (race-safe). */
export function consumeToken(db: Db, id: string): boolean {
  const consumed = db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, id), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id })
    .all()
  return consumed.length === 1
}

export function inviteLink(publicUrl: string, type: AuthTokenType, token: string) {
  const path = type === 'reset' ? 'reset' : type === 'setup' ? 'setup' : 'invite'
  return `${publicUrl}/${path}#${token}`
}
