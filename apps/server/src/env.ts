import type { AppConfig } from './config'
import type { Db } from './db'
import type { User } from './db/schema'
import type { GitHubApp } from './github/app'
import type { SecretBox } from './lib/crypto'
import { RateLimiter } from './lib/rate-limit'

const MINUTE = 60 * 1000

export function createLimiters() {
  return {
    /** All login attempts per client IP. */
    loginIp: new RateLimiter(30, 15 * MINUTE),
    /** Failed login attempts per account. */
    loginAccount: new RateLimiter(5, 15 * MINUTE),
    /** Invite/reset token lookups per client IP. */
    tokenIp: new RateLimiter(20, 15 * MINUTE),
    /** Re-authentication attempts (password/TOTP) per user. */
    reauth: new RateLimiter(10, 15 * MINUTE),
  }
}

export interface Deps {
  db: Db
  config: AppConfig
  box: SecretBox
  limiters: ReturnType<typeof createLimiters>
  /** Null when no GitHub App is configured. */
  github: GitHubApp | null
}

export interface AppEnv {
  Variables: {
    deps: Deps
    user: User | null
    sessionHash: string | null
    ip: string
  }
}

/** The variables available after `requireUser` has run. */
export interface AuthedEnv extends AppEnv {
  Variables: AppEnv['Variables'] & { user: User; sessionHash: string }
}
