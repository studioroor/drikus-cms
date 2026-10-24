import type { AppType } from '@drikus/server/app'
import { type ClientResponse, hc } from 'hono/client'

export const api = hc<AppType>('/api', {
  headers: { 'x-drikus-csrf': '1' },
  init: { credentials: 'same-origin' },
})

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

type Body<R> = R extends ClientResponse<infer T, number, string> ? T : never
type Success<R> = Exclude<Body<R>, { error: string }>

/** Awaits a typed Hono client call, returning the success body or throwing an ApiError. */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(
  call: Promise<R>,
): Promise<Success<R>> {
  let res: R
  try {
    res = await call
  } catch {
    throw new ApiError('network', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || body.error) throw new ApiError(body.error ?? 'default', res.status)
  return body as Success<R>
}
