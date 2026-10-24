import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { revokeUserSessions } from './auth/sessions'
import { createAuthToken, inviteLink } from './auth/tokens'
import { bootstrap } from './bootstrap'
import { siteMembers, sites, users } from './db/schema'
import { audit } from './lib/audit'
import { backupSettings, createBackup, listBackups } from './lib/backup'

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

const HELP = `${bold('Drikus CMS admin CLI')}

Usage: bun run cli <command> [args]

  ${bold('create-admin')} [email] [name]   Create a superadmin and print their invite link
  ${bold('link')} <email>                  Print a fresh invite or password-reset link
  ${bold('reset-2fa')} <email>             Remove two-factor auth (user must set it up again)
  ${bold('disable')} <email>               Disable an account and sign it out everywhere
  ${bold('enable')} <email>                Re-enable a disabled account
  ${bold('users')}                         List all users
  ${bold('sites')}                         List all sites
  ${bold('backup')}                        Write a database snapshot now
  ${bold('backups')}                       List database snapshots
  ${bold('migrate')}                       Apply database migrations (also happens on start)
`

function fail(message: string): never {
  console.error(red(message))
  process.exit(1)
}

function ask(question: string, fallback?: string) {
  const answer = (fallback ?? prompt(question))?.trim()
  if (!answer) fail('Aborted: no value given.')
  return answer
}

const { env, deps } = bootstrap()
const { db, config } = deps
const [command, ...args] = process.argv.slice(2)

function findUser(email: string | undefined) {
  if (!email) fail('Please provide an email address.')
  const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get()
  if (!user) fail(`No user with email ${email}.`)
  return user
}

switch (command) {
  case 'create-admin': {
    const email = z.email().safeParse(ask('Email:', args[0]).toLowerCase())
    if (!email.success) fail('That is not a valid email address.')
    if (db.select().from(users).where(eq(users.email, email.data)).get())
      fail('That email is already in use.')
    const name = ask('Name:', args[1])
    const user = db
      .insert(users)
      .values({ email: email.data, name, role: 'superadmin' })
      .returning()
      .get()
    const token = createAuthToken(db, { type: 'invite', userId: user.id })
    audit(db, { action: 'cli.admin_created', targetType: 'user', targetId: user.id })
    console.log(green(`\nSuperadmin ${email.data} created.`))
    console.log(
      `Open this link to choose a password (valid 72h):\n  ${inviteLink(config.publicUrl, 'invite', token)}\n`,
    )
    break
  }
  case 'link': {
    const user = findUser(args[0])
    const type = user.passwordHash ? 'reset' : 'invite'
    const token = createAuthToken(db, { type, userId: user.id })
    audit(db, { action: `cli.link_created.${type}`, targetType: 'user', targetId: user.id })
    console.log(
      `${type === 'reset' ? 'Password reset' : 'Invite'} link for ${user.email}:\n  ${inviteLink(config.publicUrl, type, token)}`,
    )
    break
  }
  case 'reset-2fa': {
    const user = findUser(args[0])
    db.update(users)
      .set({ totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null })
      .where(eq(users.id, user.id))
      .run()
    revokeUserSessions(db, user.id)
    audit(db, { action: 'cli.totp_reset', targetType: 'user', targetId: user.id })
    console.log(green(`Two-factor auth removed for ${user.email}.`))
    break
  }
  case 'disable':
  case 'enable': {
    const user = findUser(args[0])
    const disabled = command === 'disable'
    db.update(users)
      .set({ disabledAt: disabled ? new Date() : null })
      .where(eq(users.id, user.id))
      .run()
    if (disabled) revokeUserSessions(db, user.id)
    audit(db, { action: `cli.user_${command}d`, targetType: 'user', targetId: user.id })
    console.log(green(`${user.email} ${command}d.`))
    break
  }
  case 'users': {
    const rows = db.select().from(users).orderBy(users.email).all()
    for (const u of rows) {
      const status = u.disabledAt ? red('disabled') : u.passwordHash ? green('active') : 'invited'
      console.log(
        `${bold(u.email)} ${dim(u.name)}  ${u.role}  ${status}${u.totpSecretEnc ? '  2FA' : ''}`,
      )
    }
    if (rows.length === 0) console.log(dim('No users yet. Run `create-admin`.'))
    break
  }
  case 'sites': {
    const counts = new Map<string, number>()
    for (const m of db.select().from(siteMembers).all())
      counts.set(m.siteId, (counts.get(m.siteId) ?? 0) + 1)
    const rows = db.select().from(sites).orderBy(sites.name).all()
    for (const s of rows) {
      console.log(
        `${bold(s.name)}  ${s.repoFullName ?? dim('no repo')}@${s.branch}  ${counts.get(s.id) ?? 0} editors  ${dim(s.id)}`,
      )
    }
    if (rows.length === 0) console.log(dim('No sites yet.'))
    break
  }
  case 'backup': {
    const file = createBackup(db, backupSettings(env))
    audit(db, { action: 'backup.created', details: { file: file.name, size: file.size } })
    console.log(green(`Backup written to ${file.path}`))
    break
  }
  case 'backups': {
    const settings = backupSettings(env)
    const files = listBackups(settings.dir)
    for (const f of files) {
      const hours = Math.round((Date.now() - f.createdAt.getTime()) / 3_600_000)
      const age = hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`
      console.log(`${bold(f.name)}  ${(f.size / 1024 / 1024).toFixed(1)} MB  ${dim(age)}`)
    }
    if (files.length === 0) console.log(dim(`No backups in ${settings.dir} yet.`))
    else console.log(dim(settings.dir))
    break
  }
  case 'migrate':
    console.log(green('Database is up to date.'))
    break
  default:
    console.log(HELP)
    if (command && command !== 'help') process.exit(1)
}
