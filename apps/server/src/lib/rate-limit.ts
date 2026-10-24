/**
 * Fixed-window in-memory rate limiter. Drikus CMS runs as a single process,
 * so in-memory state is sufficient and resets harmlessly on restart.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit and returns whether the key is still within its limit. */
  hit(key: string, now = Date.now()): boolean {
    const entry = this.#hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs })
      this.#sweep(now)
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.#hits.get(key)
    return !!entry && entry.resetAt > now && entry.count >= this.limit
  }

  reset(key: string) {
    this.#hits.delete(key)
  }

  #sweep(now: number) {
    if (this.#hits.size < 10_000) return
    for (const [key, entry] of this.#hits) if (entry.resetAt <= now) this.#hits.delete(key)
  }
}
