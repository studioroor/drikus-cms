import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db'
import { users } from '../src/db/schema'
import {
  backupDue,
  createBackup,
  listBackups,
  pruneBackups,
  startBackupSchedule,
} from '../src/lib/backup'

const dirs: string[] = []
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'drikus-backup-'))
  dirs.push(dir)
  const db = openDb(join(dir, 'drikus.db'))
  writeFileSync(join(dir, 'secret.key'), 'a2V5')
  const settings = { dir: join(dir, 'backups'), keep: 3, secretKeyFile: join(dir, 'secret.key') }
  const addUser = (email: string) =>
    db.insert(users).values({ email, name: email, role: 'editor' }).run()
  return { dir, db, settings, addUser }
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const at = (iso: string) => new Date(iso)
const quiet = { log: () => {}, error: () => {} }

describe('backups', () => {
  test('a snapshot is a complete, readable copy of the database', () => {
    const w = world()
    w.addUser('anna@example.com')
    const file = createBackup(w.db, w.settings, at('2026-10-24T03:00:00.500Z'))
    expect(file.name).toBe('drikus-2026-10-24T03-00-00Z.db')
    // Written after the snapshot: not in it.
    w.addUser('piet@example.com')
    const copy = new Database(file.path, { readonly: true })
    expect(copy.query('select email from users').all()).toEqual([{ email: 'anna@example.com' }])
    expect(copy.query('pragma integrity_check').get()).toEqual({ integrity_check: 'ok' })
    copy.close()
    expect(statSync(file.path).mode & 0o777).toBe(0o600)
    expect(readdirSync(w.settings.dir).sort()).toEqual([file.name, 'secret.key'])
  })

  test('keeps the encryption key next to the snapshots, updating it when it changes', () => {
    const w = world()
    createBackup(w.db, w.settings, at('2026-10-24T03:00:00Z'))
    expect(Bun.file(join(w.settings.dir, 'secret.key')).size).toBe(4)
    writeFileSync(join(w.dir, 'secret.key'), 'bmV3a2V5')
    createBackup(w.db, w.settings, at('2026-10-25T03:00:00Z'))
    expect(Bun.file(join(w.settings.dir, 'secret.key')).size).toBe(8)
    // A key from the environment isn't copied anywhere.
    const env = world()
    createBackup(env.db, { ...env.settings, secretKeyFile: null }, at('2026-10-24T03:00:00Z'))
    expect(existsSync(join(env.settings.dir, 'secret.key'))).toBe(false)
  })

  test('lists newest first, ignores unfinished files, and prunes old ones', () => {
    const w = world()
    for (const day of ['20', '21', '22', '23', '24']) {
      createBackup(w.db, w.settings, at(`2026-10-${day}T03:00:00Z`))
    }
    writeFileSync(join(w.settings.dir, 'drikus-2026-10-25T03-00-00Z.db.tmp'), 'half')
    writeFileSync(join(w.settings.dir, 'notes.txt'), 'mine')
    expect(listBackups(w.settings.dir).map((f) => f.createdAt.getUTCDate())).toEqual([
      24, 23, 22, 21, 20,
    ])
    expect(pruneBackups(w.settings.dir, 3)).toEqual([
      'drikus-2026-10-21T03-00-00Z.db',
      'drikus-2026-10-20T03-00-00Z.db',
    ])
    expect(listBackups(w.settings.dir)).toHaveLength(3)
    expect(existsSync(join(w.settings.dir, 'notes.txt'))).toBe(true)
  })

  test('cleans up leftovers of a crashed backup, but not one still running', () => {
    const w = world()
    createBackup(w.db, w.settings, at('2026-10-24T03:00:00Z'))
    const stale = join(w.settings.dir, 'drikus-2026-10-23T03-00-00Z.db.tmp')
    const fresh = join(w.settings.dir, 'drikus-2026-10-25T02-59-00Z.db.tmp')
    writeFileSync(stale, 'x')
    writeFileSync(fresh, 'x')
    utimesSync(stale, at('2026-10-23T03:00:00Z'), at('2026-10-23T03:00:00Z'))
    utimesSync(fresh, at('2026-10-25T02:59:00Z'), at('2026-10-25T02:59:00Z'))
    createBackup(w.db, w.settings, at('2026-10-25T03:00:00Z'))
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  test('a backup is due once a day', () => {
    const w = world()
    expect(backupDue(w.settings.dir, at('2026-10-24T03:00:00Z'))).toBe(true)
    createBackup(w.db, w.settings, at('2026-10-24T03:00:00Z'))
    expect(backupDue(w.settings.dir, at('2026-10-25T02:59:59Z'))).toBe(false)
    expect(backupDue(w.settings.dir, at('2026-10-25T03:00:00Z'))).toBe(true)
  })

  test('the schedule backs up on start when due, and not again right after', () => {
    const w = world()
    const stop = startBackupSchedule(w.db, w.settings, quiet)
    stop()
    expect(listBackups(w.settings.dir)).toHaveLength(1)
    startBackupSchedule(w.db, w.settings, quiet)()
    expect(listBackups(w.settings.dir)).toHaveLength(1)
    // Turned off.
    const off = world()
    startBackupSchedule(off.db, { ...off.settings, keep: 0 }, quiet)()
    expect(existsSync(off.settings.dir)).toBe(false)
  })

  test('a failing backup is logged, not thrown', () => {
    const w = world()
    writeFileSync(w.settings.dir, 'not a folder')
    const errors: string[] = []
    startBackupSchedule(w.db, w.settings, { log: () => {}, error: (m: string) => errors.push(m) })()
    expect(errors[0]).toStartWith('Backup failed:')
  })
})
