import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  // The public origin users reach the CMS on, e.g. https://cms.example.com.
  // Used for invite links and for CSRF origin checks.
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  // 32-byte key (base64) for encrypting secrets at rest. Generated into DATA_DIR if absent.
  SECRET_KEY: z.string().optional(),
  // Directory with the built web app; served as static files when present.
  WEB_DIST: z.string().optional(),
  // Set to "true" when running behind a reverse proxy that sets X-Forwarded-For.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Set to "false" to let superadmins use the admin screens without two-step verification.
  REQUIRE_ADMIN_2FA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

export interface AppConfig {
  publicUrl: string
  publicOrigin: string
  secureCookies: boolean
  trustProxy: boolean
  /** Superadmins must enable TOTP before using admin features. */
  requireAdminTotp: boolean
}

export function loadEnv(env: Record<string, string | undefined> = process.env) {
  return EnvSchema.parse(env)
}

export function makeConfig(publicUrl: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const url = new URL(publicUrl)
  return {
    publicUrl: url.origin,
    publicOrigin: url.origin,
    secureCookies: url.protocol === 'https:',
    trustProxy: false,
    requireAdminTotp: true,
    ...overrides,
  }
}
