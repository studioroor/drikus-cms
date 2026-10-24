export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 256

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' })
}

// Verifying against a throwaway hash when the user doesn't exist keeps response
// times similar, so attackers can't discover which emails have accounts.
let dummyHash: Promise<string> | undefined

export async function verifyPassword(password: string, hash: string | null | undefined) {
  if (!hash) {
    dummyHash ??= hashPassword(crypto.randomUUID())
    await Bun.password.verify(password, await dummyHash)
    return false
  }
  return Bun.password.verify(password, hash)
}
