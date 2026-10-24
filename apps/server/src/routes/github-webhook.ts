import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { sites } from '../db/schema'
import type { AppEnv } from '../env'
import { verifyWebhookSignature } from '../github/webhook'

const ZERO_SHA = /^0+$/

interface PushEvent {
  ref: string
  after: string
  head_commit: { tree_id: string } | null
  repository: { id: number; full_name: string }
}

/**
 * Receives GitHub App webhooks. Mounted before the session and CSRF middleware:
 * the HMAC signature is what authenticates these requests.
 */
export const githubWebhookRoutes = new Hono<AppEnv>().post(
  '/',
  bodyLimit({ maxSize: 25 * 1024 * 1024 }),
  async (c) => {
    const { github, db } = c.var.deps
    if (!github?.webhookSecret) return c.json({ error: 'not_found' as const }, 404)

    const body = await c.req.text()
    if (!verifyWebhookSignature(github.webhookSecret, body, c.req.header('x-hub-signature-256'))) {
      return c.json({ error: 'invalid_signature' as const }, 401)
    }
    github.lastWebhookAt = new Date()

    const event = c.req.header('x-github-event')
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      return c.json({ error: 'invalid_input' as const }, 400)
    }

    switch (event) {
      case 'push': {
        const push = payload as unknown as PushEvent
        const linked = db.select().from(sites).where(eq(sites.repoId, push.repository.id)).all()
        for (const site of linked) {
          const onBranch = push.ref === `refs/heads/${site.branch}` && !ZERO_SHA.test(push.after)
          db.update(sites)
            .set({
              repoFullName: push.repository.full_name,
              ...(onBranch
                ? {
                    headSha: push.after,
                    headTreeSha: push.head_commit?.tree_id ?? null,
                    headCheckedAt: push.head_commit ? new Date() : null,
                  }
                : {}),
            })
            .where(eq(sites.id, site.id))
            .run()
        }
        break
      }
      case 'installation':
      case 'installation_repositories':
        github.invalidateInstallation()
        break
      // Deploy status events (check_run, status, workflow_run) are used from phase 4 on.
    }
    return c.json({ ok: true as const })
  },
)
