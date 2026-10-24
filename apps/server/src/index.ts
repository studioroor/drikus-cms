import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveStatic } from 'hono/bun'
import { createApp } from './app'
import { bootstrap, ensureSetupLink } from './bootstrap'
import { backupSettings, startBackupSchedule } from './lib/backup'

const { env, deps } = bootstrap()
const app = createApp(deps)

const webDist = resolve(env.WEB_DIST ?? join(import.meta.dir, '../../web/dist'))
if (existsSync(webDist)) {
  app.use(
    '/assets/*',
    serveStatic({
      root: webDist,
      onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  )
  app.use('*', serveStatic({ root: webDist }))
  // Single-page app: every other route renders index.html.
  const indexHtml = Bun.file(join(webDist, 'index.html'))
  app.get('*', async (c) => c.html(await indexHtml.text()))
} else {
  console.warn(`Web build not found at ${webDist}; serving the API only.`)
}

const setupLink = ensureSetupLink(deps)
if (setupLink) {
  console.log('\nNo users yet. Create the first superadmin account here (valid for 24h):')
  console.log(`  ${setupLink}\n`)
}

if (deps.github) {
  console.log(
    `GitHub App ${deps.github.webhookSecret ? 'with' : 'without'} webhooks, installed on ${deps.github.org}.`,
  )
} else {
  console.log(
    'GitHub App not configured (set GITHUB_APP_ID); sites cannot be linked to repositories yet.',
  )
}

const backups = backupSettings(env)
if (backups.keep > 0) {
  console.log(`Daily backups in ${backups.dir} (keeping ${backups.keep}).`)
  startBackupSchedule(deps.db, backups)
} else {
  console.log('Scheduled backups are off (BACKUP_KEEP=0).')
}

const server = Bun.serve({ port: env.PORT, fetch: app.fetch })
console.log(
  `Drikus CMS listening on http://localhost:${server.port} (public URL ${deps.config.publicUrl})`,
)
