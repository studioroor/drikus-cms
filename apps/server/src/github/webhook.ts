import { createHmac, timingSafeEqual } from 'node:crypto'

/** Verifies GitHub's `X-Hub-Signature-256` header against the raw request body. */
export function verifyWebhookSignature(secret: string, body: string, header: string | undefined) {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)
  const actual = Buffer.from(header)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
