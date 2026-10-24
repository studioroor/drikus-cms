import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './schema'

export type Db = ReturnType<typeof openDb>

const MIGRATIONS_DIR = join(import.meta.dir, '../../drizzle')

export function openDb(path: string) {
  const sqlite = new Database(path, { create: true, strict: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return db
}

export { schema }
