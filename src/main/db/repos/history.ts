import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import { HISTORY_LIMIT } from '../../../shared/http-utils'
import { RequestDraftSchema, type HistoryDetail, type HistoryItem, type RequestDraft } from '../../../shared/model'
import { history } from '../schema'
import type { Db } from '../types'

export interface HistoryInsert {
  draft: RequestDraft
  status: number | null
  durationMs: number | null
  sizeBytes: number | null
  responseHeaders: [string, string][]
  responseBodyPreview: string
}

/** Запись + ротация до HISTORY_LIMIT в одной транзакции */
export async function addHistory(db: Db, entry: HistoryInsert, limit = HISTORY_LIMIT): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(history)
      .values({
        requestSnapshotJson: entry.draft,
        method: entry.draft.method,
        url: entry.draft.url,
        status: entry.status,
        durationMs: entry.durationMs === null ? null : Math.round(entry.durationMs),
        sizeBytes: entry.sizeBytes,
        responseHeadersJson: entry.responseHeaders,
        // PostgreSQL text не принимает NUL-символы
        responseBodyPreview: entry.responseBodyPreview.replace(/\0/g, '')
      })
      .returning({ id: history.id })
    await tx.execute(sql`
      DELETE FROM history WHERE id IN (
        SELECT id FROM history ORDER BY created_at DESC, id DESC OFFSET ${limit}
      )`)
    return row.id
  })
}

function toItem(r: typeof history.$inferSelect): HistoryItem {
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    status: r.status,
    durationMs: r.durationMs,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt.toISOString()
  }
}

export async function listHistory(db: Db, query?: string, limit = HISTORY_LIMIT): Promise<HistoryItem[]> {
  const q = query?.trim()
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const rows = await db
    .select()
    .from(history)
    .where(pattern ? or(ilike(history.url, pattern), ilike(history.method, pattern)) : undefined)
    .orderBy(desc(history.createdAt), desc(history.id))
    .limit(limit)
  return rows.map(toItem)
}

export async function getHistory(db: Db, id: string): Promise<HistoryDetail | null> {
  const [r] = await db.select().from(history).where(eq(history.id, id))
  if (!r) return null
  return {
    ...toItem(r),
    draft: RequestDraftSchema.parse(r.requestSnapshotJson),
    responseHeaders: r.responseHeadersJson,
    responseBodyPreview: r.responseBodyPreview
  }
}

export async function deleteHistory(db: Db, id: string): Promise<void> {
  await db.delete(history).where(eq(history.id, id))
}

export async function clearHistory(db: Db): Promise<void> {
  await db.delete(history)
}
