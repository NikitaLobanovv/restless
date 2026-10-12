import { and, asc, eq, ilike, inArray, isNull, max, or, sql } from 'drizzle-orm'
import {
  RequestDraftSchema,
  type CollectionNode,
  type FolderNode,
  type RequestDraft,
  type RequestSummary,
  type SavedRequest
} from '../../../shared/model'
import { collections, folders, requests } from '../schema'
import type { Db } from '../types'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
  }
}

/* ---------- Коллекции ---------- */

export async function getTree(db: Db, workspaceId: string): Promise<CollectionNode[]> {
  const cols = await db
    .select()
    .from(collections)
    .where(eq(collections.workspaceId, workspaceId))
    .orderBy(asc(collections.sortOrder), asc(collections.createdAt))
  if (cols.length === 0) return []
  const colIds = cols.map((c) => c.id)
  const fRows = await db
    .select()
    .from(folders)
    .where(inArray(folders.collectionId, colIds))
    .orderBy(asc(folders.sortOrder), asc(folders.name))
  const rRows = await db
    .select({
      id: requests.id,
      collectionId: requests.collectionId,
      folderId: requests.folderId,
      name: requests.name,
      method: requests.method,
      url: requests.url,
      sortOrder: requests.sortOrder
    })
    .from(requests)
    .where(inArray(requests.collectionId, colIds))
    .orderBy(asc(requests.sortOrder), asc(requests.name))

  const folderMap = new Map<string, FolderNode>()
  for (const f of fRows) {
    folderMap.set(f.id, { ...f, folders: [], requests: [] })
  }
  const roots = new Map<string, CollectionNode>()
  for (const c of cols) roots.set(c.id, { id: c.id, name: c.name, folders: [], requests: [] })

  for (const f of folderMap.values()) {
    const parent = f.parentId ? folderMap.get(f.parentId) : undefined
    if (parent) parent.folders.push(f)
    else roots.get(f.collectionId)?.folders.push(f)
  }
  for (const r of rRows) {
    const parent = r.folderId ? folderMap.get(r.folderId) : undefined
    if (parent) parent.requests.push(r)
    else roots.get(r.collectionId)?.requests.push(r)
  }
  return [...roots.values()]
}

export async function createCollection(db: Db, workspaceId: string, name: string): Promise<string> {
  const [{ m }] = await db
    .select({ m: max(collections.sortOrder) })
    .from(collections)
    .where(eq(collections.workspaceId, workspaceId))
  const [row] = await db
    .insert(collections)
    .values({ workspaceId, name, sortOrder: (m ?? -1) + 1 })
    .returning({ id: collections.id })
  return row.id
}

export async function renameCollection(db: Db, id: string, name: string): Promise<void> {
  const res = await db.update(collections).set({ name }).where(eq(collections.id, id)).returning({ id: collections.id })
  if (res.length === 0) throw new NotFoundError('Collection')
}

/** Папки, запросы, вкладки и переменные удаляются каскадно (FK + триггер) */
export async function deleteCollection(db: Db, id: string): Promise<void> {
  await db.delete(collections).where(eq(collections.id, id))
}

/* ---------- Папки ---------- */

async function nextFolderOrder(db: Executor, collectionId: string, parentId: string | null): Promise<number> {
  const [{ m }] = await db
    .select({ m: max(folders.sortOrder) })
    .from(folders)
    .where(
      and(eq(folders.collectionId, collectionId), parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId))
    )
  return (m ?? -1) + 1
}

export async function createFolder(
  db: Db,
  input: { collectionId: string; parentId: string | null; name: string }
): Promise<string> {
  if (input.parentId) {
    const parent = await db.select().from(folders).where(eq(folders.id, input.parentId))
    if (!parent[0] || parent[0].collectionId !== input.collectionId) throw new NotFoundError('Parent folder')
  }
  const sortOrder = await nextFolderOrder(db, input.collectionId, input.parentId)
  const [row] = await db
    .insert(folders)
    .values({ ...input, sortOrder })
    .returning({ id: folders.id })
  return row.id
}

export async function renameFolder(db: Db, id: string, name: string): Promise<void> {
  const res = await db.update(folders).set({ name }).where(eq(folders.id, id)).returning({ id: folders.id })
  if (res.length === 0) throw new NotFoundError('Folder')
}

export async function deleteFolder(db: Db, id: string): Promise<void> {
  await db.delete(folders).where(eq(folders.id, id))
}

/** id папки и всех её потомков */
async function descendantFolderIds(db: Executor, id: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM folders WHERE id = ${id}
      UNION ALL
      SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
    )
    SELECT id FROM tree`)
  const list = Array.isArray(rows) ? rows : (rows as { rows: { id: string }[] }).rows
  return list.map((r) => r.id)
}

/** Вставляет элемент в список соседей на позицию index и перенумеровывает sort_order */
function reorder(ids: string[], movedId: string, index: number): string[] {
  const rest = ids.filter((x) => x !== movedId)
  const i = Math.max(0, Math.min(index, rest.length))
  rest.splice(i, 0, movedId)
  return rest
}

export async function moveFolder(
  db: Db,
  input: { id: string; collectionId: string; parentId: string | null; index: number }
): Promise<void> {
  await db.transaction(async (tx) => {
    const [folder] = await tx.select().from(folders).where(eq(folders.id, input.id))
    if (!folder) throw new NotFoundError('Folder')
    const subtree = await descendantFolderIds(tx, input.id)
    if (input.parentId && subtree.includes(input.parentId)) {
      throw new Error('Cannot move a folder into itself')
    }
    if (input.parentId) {
      const [parent] = await tx.select().from(folders).where(eq(folders.id, input.parentId))
      if (!parent || parent.collectionId !== input.collectionId) throw new NotFoundError('Parent folder')
    }
    if (folder.collectionId !== input.collectionId) {
      // вся ветка переезжает в другую коллекцию
      await tx.update(folders).set({ collectionId: input.collectionId }).where(inArray(folders.id, subtree))
      await tx.update(requests).set({ collectionId: input.collectionId }).where(inArray(requests.folderId, subtree))
    }
    await tx.update(folders).set({ parentId: input.parentId }).where(eq(folders.id, input.id))
    const siblings = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.collectionId, input.collectionId),
          input.parentId ? eq(folders.parentId, input.parentId) : isNull(folders.parentId)
        )
      )
      .orderBy(asc(folders.sortOrder), asc(folders.name))
    const ordered = reorder(
      siblings.map((s) => s.id),
      input.id,
      input.index
    )
    for (const [i, fid] of ordered.entries()) {
      await tx.update(folders).set({ sortOrder: i }).where(eq(folders.id, fid))
    }
  })
}

/* ---------- Запросы ---------- */

function toSaved(row: typeof requests.$inferSelect): SavedRequest {
  const draft = RequestDraftSchema.parse({
    name: row.name,
    method: row.method,
    url: row.url,
    params: row.paramsJson,
    headers: row.headersJson,
    body: { ...row.body, type: row.bodyType },
    settings: row.settingsJson
  })
  return {
    id: row.id,
    collectionId: row.collectionId,
    folderId: row.folderId,
    name: row.name,
    method: row.method,
    url: row.url,
    sortOrder: row.sortOrder,
    draft,
    updatedAt: row.updatedAt.toISOString()
  }
}

function draftColumns(draft: RequestDraft) {
  return {
    name: draft.name,
    method: draft.method.toUpperCase(),
    url: draft.url,
    paramsJson: draft.params,
    headersJson: draft.headers,
    bodyType: draft.body.type,
    body: draft.body,
    settingsJson: draft.settings
  }
}

export async function getRequest(db: Db, id: string): Promise<SavedRequest | null> {
  const [row] = await db.select().from(requests).where(eq(requests.id, id))
  return row ? toSaved(row) : null
}

async function nextRequestOrder(db: Executor, collectionId: string, folderId: string | null): Promise<number> {
  const [{ m }] = await db
    .select({ m: max(requests.sortOrder) })
    .from(requests)
    .where(
      and(
        eq(requests.collectionId, collectionId),
        folderId ? eq(requests.folderId, folderId) : isNull(requests.folderId)
      )
    )
  return (m ?? -1) + 1
}

async function assertFolderInCollection(db: Executor, folderId: string | null, collectionId: string): Promise<void> {
  if (!folderId) return
  const [f] = await db.select({ c: folders.collectionId }).from(folders).where(eq(folders.id, folderId))
  if (!f || f.c !== collectionId) throw new NotFoundError('Folder')
}

export async function saveRequest(
  db: Db,
  input: { id?: string; collectionId: string; folderId: string | null; draft: RequestDraft }
): Promise<SavedRequest> {
  return db.transaction(async (tx) => {
    await assertFolderInCollection(tx, input.folderId, input.collectionId)
    if (input.id) {
      const [existing] = await tx.select({ id: requests.id }).from(requests).where(eq(requests.id, input.id))
      if (existing) {
        const [row] = await tx
          .update(requests)
          .set({ ...draftColumns(input.draft), updatedAt: new Date() })
          .where(eq(requests.id, input.id))
          .returning()
        return toSaved(row)
      }
    }
    const sortOrder = await nextRequestOrder(tx, input.collectionId, input.folderId)
    const [row] = await tx
      .insert(requests)
      .values({
        ...(input.id ? { id: input.id } : {}),
        collectionId: input.collectionId,
        folderId: input.folderId,
        sortOrder,
        ...draftColumns(input.draft)
      })
      .returning()
    return toSaved(row)
  })
}

export async function renameRequest(db: Db, id: string, name: string): Promise<void> {
  const res = await db
    .update(requests)
    .set({ name, updatedAt: new Date() })
    .where(eq(requests.id, id))
    .returning({ id: requests.id })
  if (res.length === 0) throw new NotFoundError('Request')
}

export async function deleteRequest(db: Db, id: string): Promise<void> {
  await db.delete(requests).where(eq(requests.id, id))
}

export async function duplicateRequest(db: Db, id: string, copySuffix = ' (copy)'): Promise<RequestSummary> {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(requests).where(eq(requests.id, id))
    if (!src) throw new NotFoundError('Request')
    // копия встаёт сразу после оригинала
    await tx
      .update(requests)
      .set({ sortOrder: sql`${requests.sortOrder} + 1` })
      .where(
        and(
          eq(requests.collectionId, src.collectionId),
          src.folderId ? eq(requests.folderId, src.folderId) : isNull(requests.folderId),
          sql`${requests.sortOrder} > ${src.sortOrder}`
        )
      )
    const { id: _omit, updatedAt: _u, ...rest } = src
    void _omit
    void _u
    const [row] = await tx
      .insert(requests)
      .values({ ...rest, name: `${src.name}${copySuffix}`, sortOrder: src.sortOrder + 1 })
      .returning()
    const s = toSaved(row)
    return {
      id: s.id,
      collectionId: s.collectionId,
      folderId: s.folderId,
      name: s.name,
      method: s.method,
      url: s.url,
      sortOrder: s.sortOrder
    }
  })
}

export async function moveRequest(
  db: Db,
  input: { id: string; collectionId: string; folderId: string | null; index: number }
): Promise<void> {
  await db.transaction(async (tx) => {
    const [src] = await tx.select({ id: requests.id }).from(requests).where(eq(requests.id, input.id))
    if (!src) throw new NotFoundError('Request')
    await assertFolderInCollection(tx, input.folderId, input.collectionId)
    await tx
      .update(requests)
      .set({ collectionId: input.collectionId, folderId: input.folderId })
      .where(eq(requests.id, input.id))
    const siblings = await tx
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.collectionId, input.collectionId),
          input.folderId ? eq(requests.folderId, input.folderId) : isNull(requests.folderId)
        )
      )
      .orderBy(asc(requests.sortOrder), asc(requests.name))
    const ordered = reorder(
      siblings.map((s) => s.id),
      input.id,
      input.index
    )
    for (const [i, rid] of ordered.entries()) {
      await tx.update(requests).set({ sortOrder: i }).where(eq(requests.id, rid))
    }
  })
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Поиск по имени и URL (ILIKE использует GIN-индексы pg_trgm) */
export async function searchRequests(
  db: Db,
  workspaceId: string,
  query: string,
  limit = 50
): Promise<(RequestSummary & { collectionName: string })[]> {
  const q = query.trim()
  const pattern = `%${escapeLike(q)}%`
  const rows = await db
    .select({
      id: requests.id,
      collectionId: requests.collectionId,
      folderId: requests.folderId,
      name: requests.name,
      method: requests.method,
      url: requests.url,
      sortOrder: requests.sortOrder,
      collectionName: collections.name
    })
    .from(requests)
    .innerJoin(collections, eq(collections.id, requests.collectionId))
    .where(
      and(
        eq(collections.workspaceId, workspaceId),
        q === '' ? undefined : or(ilike(requests.name, pattern), ilike(requests.url, pattern))
      )
    )
    .orderBy(asc(requests.name))
    .limit(limit)
  return rows
}
