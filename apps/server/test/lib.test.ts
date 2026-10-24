import { describe, expect, test } from 'bun:test'
import { checkTotp } from '../src/auth/totp'
import { loadEnv } from '../src/config'
import { SecretBox } from '../src/lib/crypto'
import { RateLimiter } from '../src/lib/rate-limit'
import { ADMIN_TOTP_SECRET, totpCode } from './helpers'

describe('SecretBox', () => {
  const box = new SecretBox(Buffer.alloc(32, 1))

  test('round-trips and uses a fresh IV each time', () => {
    const a = box.encrypt('hello')
    expect(box.decrypt(a)).toBe('hello')
    expect(box.encrypt('hello')).not.toBe(a)
  })

  test('detects tampering and wrong keys', () => {
    const payload = box.encrypt('hello')
    const parts = payload.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => box.decrypt(parts.join('.'))).toThrow()
    expect(() => new SecretBox(Buffer.alloc(32, 2)).decrypt(payload)).toThrow()
  })
})

describe('RateLimiter', () => {
  test('blocks after the limit and resets after the window', () => {
    const rl = new RateLimiter(2, 1000)
    expect(rl.hit('k', 0)).toBe(true)
    expect(rl.hit('k', 1)).toBe(true)
    expect(rl.hit('k', 2)).toBe(false)
    expect(rl.isBlocked('k', 3)).toBe(true)
    expect(rl.hit('k', 1001)).toBe(true)
  })
})

describe('checkTotp', () => {
  test('accepts the current and adjacent step only', () => {
    const now = 1_700_000_000_000
    expect(checkTotp(ADMIN_TOTP_SECRET, totpCode(ADMIN_TOTP_SECRET, now), now)).not.toBeNull()
    expect(
      checkTotp(ADMIN_TOTP_SECRET, totpCode(ADMIN_TOTP_SECRET, now - 30_000), now),
    ).not.toBeNull()
    expect(checkTotp(ADMIN_TOTP_SECRET, totpCode(ADMIN_TOTP_SECRET, now - 120_000), now)).toBeNull()
    expect(checkTotp(ADMIN_TOTP_SECRET, 'abcdef', now)).toBeNull()
  })
})

describe('loadEnv', () => {
  test('requires admin 2FA unless explicitly disabled', () => {
    expect(loadEnv({}).REQUIRE_ADMIN_2FA).toBe(true)
    expect(loadEnv({ REQUIRE_ADMIN_2FA: 'false' }).REQUIRE_ADMIN_2FA).toBe(false)
    expect(() => loadEnv({ REQUIRE_ADMIN_2FA: 'no' })).toThrow()
  })
})
