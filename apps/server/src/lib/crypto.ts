import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** AES-256-GCM encryption for small secrets (e.g. TOTP seeds) stored in SQLite. */
export class SecretBox {
  readonly #key: Buffer

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes')
    this.#key = key
  }

  static fromBase64(value: string): SecretBox {
    return new SecretBox(Buffer.from(value, 'base64'))
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.')
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.')
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted payload')
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
