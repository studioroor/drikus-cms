import { eq } from 'drizzle-orm'
import { Secret, TOTP } from 'otpauth'
import type { Db } from '../db'
import { type User, users } from '../db/schema'

const PERIOD = 30

function totpFor(secret: string, label = 'Drikus CMS') {
  return new TOTP({
    issuer: 'Drikus CMS',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  })
}

export function generateTotpSecret(label: string) {
  const secret = new Secret({ size: 20 }).base32
  return { secret, uri: totpFor(secret, label).toString() }
}

/** Returns the matched time step, or null when the code is invalid. */
export function checkTotp(secret: string, code: string, now = Date.now()): number | null {
  const token = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(token)) return null
  const delta = totpFor(secret).validate({ token, timestamp: now, window: 1 })
  if (delta === null) return null
  return Math.floor(now / 1000 / PERIOD) + delta
}

/**
 * Verifies a code against the user's enabled secret and records the step so
 * the same code can't be replayed within its validity window.
 */
export function verifyUserTotp(db: Db, user: User, secret: string, code: string): boolean {
  const step = checkTotp(secret, code)
  if (step === null) return false
  if (user.totpLastStep !== null && step <= user.totpLastStep) return false
  db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id)).run()
  return true
}
