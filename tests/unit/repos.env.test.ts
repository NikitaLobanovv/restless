import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDraft } from '../../src/shared/model'
import { mergeLayers } from '../../src/shared/variables'
import * as col from '../../src/main/db/repos/collections'
import * as env from '../../src/main/db/repos/environments'
import * as hist from '../../src/main/db/repos/history'
import * as tabs from '../../src/main/db/repos/tabs'
import type { Db } from '../../src/main/db/types'
import { createTestDb, fakeCodec } from '../helpers/db'

let db: Db
let ws: string
let close: () => Promise<void>

beforeEach(async () => {
  ;({ db, workspaceId: ws, close } = await createTestDb())
})
afterEach(async () => {
  await close()
})

describe('окружения', () => {
  it('создание, переименование, активное окружение, удаление', async () => {
    const dev = await env.createEnvironment(db, ws, 'dev')
    const prod = await env.createEnvironment(db, ws, 'prod')
    await env.setActiveEnvironment(db, ws, dev)
    await env.setActiveEnvironment(db, ws, prod)
    expect((await env.listEnvironments(db, ws)).filter((e) => e.isActive).map((e) => e.name)).toEqual(['prod'])
    expect(await env.getActiveEnvironmentId(db, ws)).toBe(prod)
    await env.setActiveEnvironment(db, ws, null)
    expect(await env.getActiveEnvironmentId(db, ws)).toBeNull()
    await env.renameEnvironment(db, dev, 'development')
    await env.deleteEnvironment(db, prod)
    expect((await env.listEnvironments(db, ws)).map((e) => e.name)).toEqual(['development'])
    await expect(env.renameEnvironment(db, prod, 'x')).rejects.toThrow('not found')
    await expect(env.setActiveEnvironment(db, ws, prod)).rejects.toThrow('not found')
  })
})

describe('переменные', () => {
  it('секрет хранится зашифрованным и не отдаётся в представлении', async () => {
    const views = await env.saveVariables(
      db,
      'global',
      ws,
      [
        { key: 'baseUrl', value: 'https://api', isSecret: false },
        { key: 'token', value: 's3cr3t', isSecret: true }
      ],
      fakeCodec
    )
    expect(views.find((v) => v.key === 'token')).toMatchObject({ value: null, isSecret: true, hasValue: true })
    // читаем таблицу в обход репозитория — как это сделал бы посторонний
    const raw = (await db.execute(sql`select key, value from variables order by key`)) as unknown as {
      rows: { key: string; value: string }[]
    }
    const token = raw.rows.find((r) => r.key === 'token')
    expect(token?.value.startsWith('enc:v1:')).toBe(true)
    expect(token?.value).not.toContain('s3cr3t')
  })

  it('секрет без нового значения сохраняет прежнее; перестановка ключей без конфликтов', async () => {
    const first = await env.saveVariables(
      db,
      'global',
      ws,
      [
        { key: 'a', value: '1', isSecret: false },
        { key: 'token', value: 'old', isSecret: true }
      ],
      fakeCodec
    )
    const a = first.find((v) => v.key === 'a')!
    const tok = first.find((v) => v.key === 'token')!
    // меняем местами ключи и не передаём значение секрета
    await env.saveVariables(
      db,
      'global',
      ws,
      [
        { id: tok.id, key: 'token', isSecret: true },
        { id: a.id, key: 'a', value: '2', isSecret: false }
      ],
      fakeCodec
    )
    const layers = await env.loadVariableLayers(db, ws, null, fakeCodec)
    expect(layers.layers[2]).toEqual({ token: 'old', a: '2' })
    expect(layers.secretValues).toEqual(['old'])

    // обычная → секретная: значение шифруется
    await env.saveVariables(db, 'global', ws, [{ id: a.id, key: 'a', isSecret: true }], fakeCodec)
    expect((await env.listVariables(db, 'global', ws))[0]).toMatchObject({ key: 'a', isSecret: true, value: null })
    expect((await env.loadVariableLayers(db, ws, null, fakeCodec)).layers[2]).toEqual({ a: '2' })

    // секретная → обычная без значения: старое значение не раскрывается
    await env.saveVariables(db, 'global', ws, [{ id: a.id, key: 'a', isSecret: false }], fakeCodec)
    expect((await env.listVariables(db, 'global', ws))[0]).toMatchObject({ value: '' })
  })

  it('дубликаты ключей отклоняются', async () => {
    await expect(
      env.saveVariables(
        db,
        'global',
        ws,
        [
          { key: 'x', value: '1', isSecret: false },
          { key: 'x', value: '2', isSecret: false }
        ],
        fakeCodec
      )
    ).rejects.toThrow('Duplicate')
  })

  it('приоритет окружение → коллекция → глобальные', async () => {
    const c = await col.createCollection(db, ws, 'C')
    const e = await env.createEnvironment(db, ws, 'dev')
    await env.setActiveEnvironment(db, ws, e)
    await env.saveVariables(
      db,
      'global',
      ws,
      [
        { key: 'v', value: 'global', isSecret: false },
        { key: 'g', value: 'g', isSecret: false }
      ],
      fakeCodec
    )
    await env.saveVariables(
      db,
      'collection',
      c,
      [
        { key: 'v', value: 'collection', isSecret: false },
        { key: 'c', value: 'c', isSecret: false }
      ],
      fakeCodec
    )
    await env.saveVariables(db, 'environment', e, [{ key: 'v', value: 'env', isSecret: false }], fakeCodec)
    const { layers, sources } = await env.loadVariableLayers(db, ws, c, fakeCodec)
    expect(mergeLayers(layers)).toEqual({ v: 'env', c: 'c', g: 'g' })
    expect(sources.map((s) => s.scope)).toEqual(['environment', 'collection', 'global'])

    // битое значение секрета не роняет загрузку
    const broken = {
      ...fakeCodec,
      decrypt: () => {
        throw new Error('bad key')
      }
    }
    await env.saveVariables(db, 'global', ws, [{ key: 's', value: 'x', isSecret: true }], fakeCodec)
    expect((await env.loadVariableLayers(db, ws, null, broken)).layers[2]).toEqual({ s: '' })
  })

  it('переменные удаляются вместе с коллекцией и окружением (триггеры)', async () => {
    const c = await col.createCollection(db, ws, 'C')
    const e = await env.createEnvironment(db, ws, 'dev')
    await env.saveVariables(db, 'collection', c, [{ key: 'a', value: '1', isSecret: false }], fakeCodec)
    await env.saveVariables(db, 'environment', e, [{ key: 'b', value: '1', isSecret: false }], fakeCodec)
    await col.deleteCollection(db, c)
    await env.deleteEnvironment(db, e)
    expect(await env.listVariables(db, 'collection', c)).toEqual([])
    expect(await env.listVariables(db, 'environment', e)).toEqual([])
  })
})

describe('история', () => {
  const entry = (url: string) => ({
    draft: { ...emptyDraft(), url },
    status: 200,
    durationMs: 12.6,
    sizeBytes: 10,
    responseHeaders: [['content-type', 'text/plain']] as [string, string][],
    responseBodyPreview: 'ok\0'
  })

  it('запись, чтение, поиск, удаление, очистка', async () => {
    const id = await hist.addHistory(db, entry('https://x.io/a'))
    await hist.addHistory(db, entry('https://x.io/b'))
    expect((await hist.listHistory(db)).map((h) => h.url)).toEqual(['https://x.io/b', 'https://x.io/a'])
    expect((await hist.listHistory(db, '/a')).map((h) => h.url)).toEqual(['https://x.io/a'])
    const detail = await hist.getHistory(db, id)
    expect(detail).toMatchObject({ durationMs: 13, responseBodyPreview: 'ok', status: 200 })
    expect(detail?.draft.url).toBe('https://x.io/a')
    await hist.deleteHistory(db, id)
    expect(await hist.getHistory(db, id)).toBeNull()
    await hist.clearHistory(db)
    expect(await hist.listHistory(db)).toEqual([])
  })

  it('ротация по лимиту', async () => {
    for (let i = 0; i < 6; i++) await hist.addHistory(db, entry(`https://x.io/${i}`), 4)
    const list = await hist.listHistory(db)
    expect(list).toHaveLength(4)
    expect(list[0].url).toBe('https://x.io/5')
  })
})

describe('вкладки', () => {
  it('сохранение и восстановление; ссылки на удалённые запросы обнуляются', async () => {
    const c = await col.createCollection(db, ws, 'C')
    const r = await col.saveRequest(db, { collectionId: c, folderId: null, draft: emptyDraft() })
    const d = { ...emptyDraft(), url: 'https://draft' }
    await tabs.saveTabs(db, [
      {
        id: '22222222-2222-4222-8222-222222222222',
        requestId: r.id,
        collectionId: c,
        draft: d,
        savedDraft: emptyDraft(),
        position: 0,
        isActive: false
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        requestId: '44444444-4444-4444-8444-444444444444',
        collectionId: '55555555-5555-4555-8555-555555555555',
        draft: d,
        savedDraft: null,
        position: 1,
        isActive: true
      }
    ])
    const loaded = await tabs.loadTabs(db)
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toMatchObject({ requestId: r.id, collectionId: c, isActive: false })
    expect(loaded[0].draft.url).toBe('https://draft')
    expect(loaded[1]).toMatchObject({ requestId: null, collectionId: null, isActive: true, savedDraft: null })
    expect(loaded[0].savedDraft?.url).toBe('')

    // удаление запроса каскадно закрывает его вкладку
    await col.deleteRequest(db, r.id)
    expect(await tabs.loadTabs(db)).toHaveLength(1)
    await tabs.saveTabs(db, [])
    expect(await tabs.loadTabs(db)).toEqual([])
  })
})
