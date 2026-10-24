import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Env } from '../config'
import type { Db } from '../db'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** drikus-2026-10-24T03-00-00Z.db: sorts by time, safe in every file system. */
const NAME = /^drikus-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.db$/

export interface BackupSettings {
  dir: string
  /** How many scheduled snapshots to keep; 0 turns the schedule off. */
  keep: number
  /** The encryption key file to keep next to the snapshots, or null when it comes from env. */
  secretKeyFile: string | null
}

export interface BackupFile {
  name: string
  path: string
  size: number
  createdAt: Date
}

export function backupSettings(env: Env): BackupSettings {
  return {
    dir: env.BACKUP_DIR ?? join(env.DATA_DIR, 'backups'),
    keep: env.BACKUP_KEEP,
    secretKeyFile: env.SECRET_KEY ? null : join(env.DATA_DIR, 'secret.key'),
  }
}

function backupName(now: Date) {
  return `drikus-${now.toISOString().slice(0, 19).replaceAll(':', '-')}Z.db`
}

function syncFile(path: string) {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Snapshots, newest first. Unfinished (.tmp) and unrelated files are ignored. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return []
  const files: BackupFile[] = []
  for (const name of readdirSync(dir)) {
    const m = NAME.exec(name)
    if (!m) continue
    const path = join(dir, name)
    files.push({
      name,
      path,
      size: statSync(path).size,
      createdAt: new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`),
    })
  }
  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/**
 * Writes a consistent copy of the database (VACUUM INTO works while others
 * read and write, WAL included), plus the key needed to read its secrets.
 */
export function createBackup(db: Db, settings: BackupSettings, now = new Date()): BackupFile {
  mkdirSync(settings.dir, { recursive: true, mode: 0o700 })
  // Leftovers of a crashed run; recent ones may belong to a backup still running.
  for (const name of readdirSync(settings.dir)) {
    const path = join(settings.dir, name)
    if (name.endsWith('.db.tmp') && now.getTime() - statSync(path).mtimeMs > HOUR) unlinkSync(path)
  }
  const name = backupName(now)
  const path = join(settings.dir, name)
  const tmp = `${path}.tmp`
  if (existsSync(tmp)) unlinkSync(tmp)
  db.$client.run('VACUUM INTO ?', [tmp])
  chmodSync(tmp, 0o600)
  syncFile(tmp)
  renameSync(tmp, path)

  const key = settings.secretKeyFile
  if (key && existsSync(key)) {
    const copy = join(settings.dir, 'secret.key')
    if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(key))) {
      copyFileSync(key, copy)
      chmodSync(copy, 0o600)
    }
  }
  return {
    name,
    path,
    size: statSync(path).size,
    createdAt: new Date(Math.floor(now.getTime() / 1000) * 1000),
  }
}

/** Removes all but the newest `keep` snapshots; returns the removed names. */
export function pruneBackups(dir: string, keep: number): string[] {
  const old = listBackups(dir).slice(Math.max(keep, 1))
  for (const f of old) unlinkSync(f.path)
  return old.map((f) => f.name)
}

/** True when there is no snapshot from the last day. */
export function backupDue(dir: string, now = new Date()) {
  const newest = listBackups(dir)[0]
  return !newest || now.getTime() - newest.createdAt.getTime() >= DAY
}

/**
 * Takes a daily snapshot. Checks at start and then every hour, so restarts
 * and machines that sleep (Fly.io auto-stop) still get one per day.
 * Returns a function that stops the schedule.
 */
export function startBackupSchedule(
  db: Db,
  settings: BackupSettings,
  log: Pick<Console, 'log' | 'error'> = console,
): () => void {
  if (settings.keep <= 0) return () => {}
  const tick = () => {
    try {
      if (!backupDue(settings.dir)) return
      const file = createBackup(db, settings)
      const removed = pruneBackups(settings.dir, settings.keep)
      log.log(
        `Backup written to ${file.path}${removed.length ? ` (removed ${removed.length} old)` : ''}.`,
      )
    } catch (err) {
      log.error(`Backup failed: ${(err as Error).message}`)
    }
  }
  tick()
  const timer = setInterval(tick, HOUR)
  timer.unref()
  return () => clearInterval(timer)
}
