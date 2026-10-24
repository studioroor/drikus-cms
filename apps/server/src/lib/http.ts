import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'

/** Zod validator returning a uniform `{ error: 'invalid_input' }` payload. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: 'invalid_input' as const,
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      )
    }
  })
}

export const errorBody = <E extends string>(error: E) => ({ error })
