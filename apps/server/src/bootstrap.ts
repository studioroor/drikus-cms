import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuthToken, inviteLink } from './auth/tokens'
import { loadEnv, makeConfig } from './config'
import { openDb } from './db'
import { users } from './db/schema'
import { createLimiters, type Deps } from './env'
import { SecretBox } from './lib/crypto'

/** Loads the at-rest encryption key from env, or from (or into) DATA_DIR/secret.key. */
function loadSecretBox(dataDir: string, envKey?: string) {
  if (envKey) return SecretBox.fromBase64(envKey)
  const keyPath = join(dataDir, 'secret.key')
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600 })
    console.log(`Generated encryption key at ${keyPath} — back it up together with the database.`)
  }
  return SecretBox.fromBase64(readFileSync(keyPath, 'utf8').trim())
}

export function bootstrap(env = process.env) {
  const parsed = loadEnv(env)
  mkdirSync(parsed.DATA_DIR, { recursive: true })
  const deps: Deps = {
    db: openDb(join(parsed.DATA_DIR, 'drikus.db')),
    config: makeConfig(parsed.PUBLIC_URL, {
      trustProxy: parsed.TRUST_PROXY,
      requireAdminTotp: parsed.REQUIRE_ADMIN_2FA,
    }),
    box: loadSecretBox(parsed.DATA_DIR, parsed.SECRET_KEY),
    limiters: createLimiters(),
  }
  return { env: parsed, deps }
}

/** On a fresh install, prints a one-time link to create the first superadmin. */
export function ensureSetupLink(deps: Deps) {
  if (deps.db.select({ id: users.id }).from(users).limit(1).get()) return null
  const token = createAuthToken(deps.db, { type: 'setup' })
  return inviteLink(deps.config.publicUrl, 'setup', token)
}
