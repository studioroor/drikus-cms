import type { Db } from '../db'
import { auditLog } from '../db/schema'

export interface AuditEntry {
  actorId?: string | null
  action: string
  targetType?: string
  targetId?: string
  ip?: string | null
  details?: Record<string, unknown>
}

export function audit(db: Db, entry: AuditEntry) {
  db.insert(auditLog)
    .values({ ...entry, at: new Date() })
    .run()
}
