import { asc, inArray } from 'drizzle-orm'
import { RequestDraftSchema, type OpenTabState } from '../../../shared/model'
import { collections, openTabs, requests } from '../schema'
import type { Db } from '../types'

export async function loadTabs(db: Db): Promise<OpenTabState[]> {
  const rows = await db.select().from(openTabs).orderBy(asc(openTabs.position))
  const out: OpenTabState[] = []
  for (const r of rows) {
    const draft = RequestDraftSchema.safeParse(r.draftJson)
    if (!draft.success) continue
    const saved = r.savedDraftJson ? RequestDraftSchema.safeParse(r.savedDraftJson) : null
    out.push({
      id: r.id,
      requestId: r.requestId,
      collectionId: r.collectionId,
      draft: draft.data,
      savedDraft: saved?.success ? saved.data : null,
      position: r.position,
      isActive: r.isActive
    })
  }
  return out
}

/** Полная замена набора вкладок одной транзакцией */
export async function saveTabs(db: Db, tabs: OpenTabState[]): Promise<void> {
  await db.transaction(async (tx) => {
    // ссылки на удалённые запросы/коллекции обнуляем, чтобы не нарушить FK
    const reqIds = [...new Set(tabs.map((t) => t.requestId).filter((x): x is string => !!x))]
    const colIds = [...new Set(tabs.map((t) => t.collectionId).filter((x): x is string => !!x))]
    const liveReq = new Set(
      reqIds.length
        ? (await tx.select({ id: requests.id }).from(requests).where(inArray(requests.id, reqIds))).map((r) => r.id)
        : []
    )
    const liveCol = new Set(
      colIds.length
        ? (await tx.select({ id: collections.id }).from(collections).where(inArray(collections.id, colIds))).map(
            (r) => r.id
          )
        : []
    )
    await tx.delete(openTabs)
    if (tabs.length === 0) return
    await tx.insert(openTabs).values(
      tabs.map((t, i) => ({
        id: t.id,
        requestId: t.requestId && liveReq.has(t.requestId) ? t.requestId : null,
        collectionId: t.collectionId && liveCol.has(t.collectionId) ? t.collectionId : null,
        draftJson: t.draft,
        // исходная версия нужна и несохранённым вкладкам — по ней виден индикатор изменений
        savedDraftJson: t.savedDraft,
        position: i,
        isActive: t.isActive
      }))
    )
  })
}
