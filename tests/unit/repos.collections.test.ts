import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDraft, type RequestDraft } from '../../src/shared/model'
import * as col from '../../src/main/db/repos/collections'
import { ensureDefaultWorkspace } from '../../src/main/db/repos/workspace'
import type { Db } from '../../src/main/db/types'
import { createTestDb } from '../helpers/db'

let db: Db
let ws: string
let close: () => Promise<void>

beforeEach(async () => {
  ;({ db, workspaceId: ws, close } = await createTestDb())
})
afterEach(async () => {
  await close()
})

function draft(name: string, url = 'https://x.io'): RequestDraft {
  return { ...emptyDraft(), name, url }
}

describe('коллекции и папки', () => {
  it('рабочее пространство создаётся один раз', async () => {
    expect(await ensureDefaultWorkspace(db)).toBe(ws)
  })

  it('CRUD коллекций и дерево', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const b = await col.createCollection(db, ws, 'B')
    const f1 = await col.createFolder(db, { collectionId: a, parentId: null, name: 'f1' })
    const f2 = await col.createFolder(db, { collectionId: a, parentId: f1, name: 'f2' })
    await col.saveRequest(db, { collectionId: a, folderId: f2, draft: draft('deep') })
    await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('root') })
    await col.renameCollection(db, b, 'B2')

    const tree = await col.getTree(db, ws)
    expect(tree.map((c) => c.name)).toEqual(['A', 'B2'])
    expect(tree[0].requests.map((r) => r.name)).toEqual(['root'])
    expect(tree[0].folders[0].name).toBe('f1')
    expect(tree[0].folders[0].folders[0].requests[0].name).toBe('deep')

    await col.renameFolder(db, f2, 'f2-renamed')
    expect((await col.getTree(db, ws))[0].folders[0].folders[0].name).toBe('f2-renamed')

    await col.deleteFolder(db, f1)
    const after = await col.getTree(db, ws)
    expect(after[0].folders).toEqual([])
    expect(after[0].requests).toHaveLength(1)

    await col.deleteCollection(db, a)
    expect((await col.getTree(db, ws)).map((c) => c.id)).toEqual([b])
  })

  it('ошибки «не найдено»', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(col.renameCollection(db, missing, 'x')).rejects.toThrow(col.NotFoundError)
    await expect(col.renameFolder(db, missing, 'x')).rejects.toThrow('Folder not found')
    await expect(col.renameRequest(db, missing, 'x')).rejects.toThrow('Request not found')
    await expect(col.duplicateRequest(db, missing)).rejects.toThrow('Request not found')
    await expect(
      col.moveRequest(db, { id: missing, collectionId: missing, folderId: null, index: 0 })
    ).rejects.toThrow()
    await expect(col.moveFolder(db, { id: missing, collectionId: missing, parentId: null, index: 0 })).rejects.toThrow()
    expect(await col.getRequest(db, missing)).toBeNull()
  })

  it('папка не может лежать в чужой коллекции', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const b = await col.createCollection(db, ws, 'B')
    const fa = await col.createFolder(db, { collectionId: a, parentId: null, name: 'fa' })
    await expect(col.createFolder(db, { collectionId: b, parentId: fa, name: 'x' })).rejects.toThrow()
    await expect(col.saveRequest(db, { collectionId: b, folderId: fa, draft: draft('r') })).rejects.toThrow()
  })

  it('перенос папки в другую коллекцию переносит всю ветку (одна транзакция)', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const b = await col.createCollection(db, ws, 'B')
    const f1 = await col.createFolder(db, { collectionId: a, parentId: null, name: 'f1' })
    const f2 = await col.createFolder(db, { collectionId: a, parentId: f1, name: 'f2' })
    const r = await col.saveRequest(db, { collectionId: a, folderId: f2, draft: draft('deep') })
    const target = await col.createFolder(db, { collectionId: b, parentId: null, name: 'target' })

    await col.moveFolder(db, { id: f1, collectionId: b, parentId: target, index: 0 })
    const moved = await col.getRequest(db, r.id)
    expect(moved?.collectionId).toBe(b)
    const tree = await col.getTree(db, ws)
    expect(tree[0].folders).toEqual([])
    expect(tree[1].folders[0].folders[0].name).toBe('f1')

    // в самого себя нельзя
    await expect(col.moveFolder(db, { id: f1, collectionId: b, parentId: f2, index: 0 })).rejects.toThrow('into itself')
  })

  it('порядок папок при перестановке', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const x = await col.createFolder(db, { collectionId: a, parentId: null, name: 'x' })
    const y = await col.createFolder(db, { collectionId: a, parentId: null, name: 'y' })
    const z = await col.createFolder(db, { collectionId: a, parentId: null, name: 'z' })
    await col.moveFolder(db, { id: z, collectionId: a, parentId: null, index: 0 })
    expect((await col.getTree(db, ws))[0].folders.map((f) => f.id)).toEqual([z, x, y])
  })
})

describe('запросы', () => {
  it('сохранение, обновление и чтение черновика целиком', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const d = draft('Get users', '{{base}}/users')
    d.method = 'post'
    d.headers = [{ id: 'h', key: 'X', value: '1', description: 'd', enabled: true }]
    d.body = { ...d.body, type: 'json', raw: '{"a":1}' }
    const saved = await col.saveRequest(db, { collectionId: a, folderId: null, draft: d })
    expect(saved.method).toBe('POST')
    expect(saved.draft.body).toMatchObject({ type: 'json', raw: '{"a":1}' })

    const updated = await col.saveRequest(db, {
      id: saved.id,
      collectionId: a,
      folderId: null,
      draft: { ...saved.draft, url: 'https://changed' }
    })
    expect(updated.id).toBe(saved.id)
    expect((await col.getRequest(db, saved.id))?.url).toBe('https://changed')

    // сохранение с заранее известным id (новый запрос)
    const withId = await col.saveRequest(db, {
      id: '11111111-1111-4111-8111-111111111111',
      collectionId: a,
      folderId: null,
      draft: draft('fixed')
    })
    expect(withId.id).toBe('11111111-1111-4111-8111-111111111111')

    await col.renameRequest(db, saved.id, 'renamed')
    expect((await col.getRequest(db, saved.id))?.name).toBe('renamed')
    await col.deleteRequest(db, saved.id)
    expect(await col.getRequest(db, saved.id)).toBeNull()
  })

  it('дублирование ставит копию сразу после оригинала', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const r1 = await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('one') })
    await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('two') })
    const copy = await col.duplicateRequest(db, r1.id, ' (копия)')
    expect(copy.name).toBe('one (копия)')
    const names = (await col.getTree(db, ws))[0].requests.map((r) => r.name)
    expect(names).toEqual(['one', 'one (копия)', 'two'])
  })

  it('перенос запроса между папками и коллекциями с позицией', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const b = await col.createCollection(db, ws, 'B')
    const fb = await col.createFolder(db, { collectionId: b, parentId: null, name: 'fb' })
    const r1 = await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('r1') })
    const r2 = await col.saveRequest(db, { collectionId: b, folderId: fb, draft: draft('r2') })
    await col.moveRequest(db, { id: r1.id, collectionId: b, folderId: fb, index: 0 })
    const tree = await col.getTree(db, ws)
    expect(tree[0].requests).toEqual([])
    expect(tree[1].folders[0].requests.map((r) => r.id)).toEqual([r1.id, r2.id])
  })

  it('поиск по имени и URL (ILIKE, экранирование %)', async () => {
    const a = await col.createCollection(db, ws, 'API')
    await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('List users', 'https://x.io/users') })
    await col.saveRequest(db, { collectionId: a, folderId: null, draft: draft('Orders', 'https://x.io/orders?p=100%') })
    expect((await col.searchRequests(db, ws, 'USER')).map((r) => r.name)).toEqual(['List users'])
    expect((await col.searchRequests(db, ws, 'orders')).map((r) => r.collectionName)).toEqual(['API'])
    expect(await col.searchRequests(db, ws, '%')).toHaveLength(1)
    expect(await col.searchRequests(db, ws, '')).toHaveLength(2)
  })
})
