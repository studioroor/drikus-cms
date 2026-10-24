import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuthToken, inviteLink } from './auth/tokens'
import { type Env, loadEnv, makeConfig } from './config'
import { openDb } from './db'
import { users } from './db/schema'
import { createLimiters, type Deps } from './env'
import { GitHubApp } from './github/app'
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

function readPrivateKey(env: Env): string {
  const inline = env.GITHUB_APP_PRIVATE_KEY?.trim()
  if (inline) {
    return inline.includes('-----BEGIN') ? inline : Buffer.from(inline, 'base64').toString('utf8')
  }
  const file = env.GITHUB_APP_PRIVATE_KEY_FILE ?? join(env.DATA_DIR, 'github-app.pem')
  if (!existsSync(file)) {
    throw new Error(`GITHUB_APP_ID is set, but the private key file ${file} does not exist.`)
  }
  return readFileSync(file, 'utf8')
}

/** Creates the GitHub App client, or null when GitHub isn't configured. Fails fast on bad config. */
export function createGitHubApp(env: Env): GitHubApp | null {
  if (!env.GITHUB_APP_ID) return null
  try {
    return new GitHubApp({
      appId: env.GITHUB_APP_ID,
      privateKey: readPrivateKey(env),
      org: env.GITHUB_ORG,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      apiUrl: env.GITHUB_API_URL,
    })
  } catch (err) {
    throw new Error(`Invalid GitHub App configuration: ${(err as Error).message}`)
  }
}

export function bootstrap(env = process.env) {
  const parsed = loadEnv(env)
  mkdirSync(parsed.DATA_DIR, { recursive: true })
  const deps: Deps = {
    db: openDb(join(parsed.DATA_DIR, 'drikus.db')),
    config: makeConfig(parsed.PUBLIC_URL, { trustProxy: parsed.TRUST_PROXY }),
    box: loadSecretBox(parsed.DATA_DIR, parsed.SECRET_KEY),
    limiters: createLimiters(),
    github: createGitHubApp(parsed),
  }
  return { env: parsed, deps }
}

/** On a fresh install, prints a one-time link to create the first superadmin. */
export function ensureSetupLink(deps: Deps) {
  if (deps.db.select({ id: users.id }).from(users).limit(1).get()) return null
  const token = createAuthToken(deps.db, { type: 'setup' })
  return inviteLink(deps.config.publicUrl, 'setup', token)
}
