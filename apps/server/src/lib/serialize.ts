import type { User } from '../db/schema'
import { mustEnableTotp } from '../middleware/auth'

export function publicUser(user: User, requireAdminTotp: boolean) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    totpEnabled: !!user.totpSecretEnc,
    mustEnableTotp: mustEnableTotp(user, requireAdminTotp),
  }
}

export type PublicUser = ReturnType<typeof publicUser>
