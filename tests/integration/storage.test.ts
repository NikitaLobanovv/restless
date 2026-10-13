import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyDraft } from '../../src/shared/model'
import * as col from '../../src/main/db/repos/collections'
import * as env from '../../src/main/db/repos/environments'
import * as hist from '../../src/main/db/repos/history'
import { ensureDefaultWorkspace } from '../../src/main/db/repos/workspace'
import * as schema from '../../src/main/db/schema'
import type { Db } from '../../src/main/db/types'
import { fakeCodec, migrationsFolder } from '../helpers/db'

const baseUrl = process.env.DATABASE_URL ?? 'postgres://restless:change-me@localhost:5432/restless'
const TEST_DB = 'restless_it'

let admin: pg.Client
let pool: pg.Pool
let db: Db
let ws: string

beforeAll(async () => {
  admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${TEST_DB}`)
  const url = new URL(baseUrl)
  url.pathname = `/${TEST_DB}`
  pool = new pg.Pool({ connectionString: url.toString(), max: 5 })
  db = drizzle(pool, { schema }) as unknown as Db
  await migrate(drizzle(pool), {
    migrationsFolder,
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public'
  })
  await migrate(drizzle(pool), {
    migrationsFolder,
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public'
  })
  ws = await ensureDefaultWorkspace(db)
})

afterAll(async () => {
  await pool?.end()
  await admin?.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
  await admin?.end()
})

describe('хранилище на PostgreSQL', () => {
  it('pg_trgm и GIN-индексы на месте', async () => {
    const ext = await pool.query(`select 1 from pg_extension where extname = 'pg_trgm'`)
    expect(ext.rowCount).toBe(1)
    const idx = await pool.query(
      `select indexname from pg_indexes where tablename = 'requests' and indexdef ilike '%gin%'`
    )
    expect(idx.rows.map((r) => r.indexname).sort()).toEqual(['requests_name_trgm_idx', 'requests_url_trgm_idx'])
  })

  it('перенос папки атомарен: при ошибке ничего не меняется', async () => {
    const a = await col.createCollection(db, ws, 'A')
    const f1 = await col.createFolder(db, { collectionId: a, parentId: null, name: 'f1' })
    const f2 = await col.createFolder(db, { collectionId: a, parentId: f1, name: 'f2' })
    await expect(col.moveFolder(db, { id: f1, collectionId: a, parentId: f2, index: 0 })).rejects.toThrow()
    const tree = await col.getTree(db, ws)
    const c = tree.find((x) => x.id === a)!
    expect(c.folders[0].id).toBe(f1)
    expect(c.folders[0].folders[0].id).toBe(f2)
  })

  it('секретная переменная не читается из таблицы в открытом виде', async () => {
    await env.saveVariables(db, 'global', ws, [{ key: 'apiKey', value: 'top-secret-value', isSecret: true }], fakeCodec)
    const raw = await pool.query(`select value from variables where key = 'apiKey'`)
    expect(raw.rows[0].value).toMatch(/^enc:v1:/)
    expect(raw.rows[0].value).not.toContain('top-secret-value')
  })

  it('поиск использует ILIKE по имени и URL', async () => {
    const a = await col.createCollection(db, ws, 'Search')
    await col.saveRequest(db, {
      collectionId: a,
      folderId: null,
      draft: { ...emptyDraft(), name: 'Найти пользователя', url: 'https://x/users/42' }
    })
    expect((await col.searchRequests(db, ws, 'пользоват')).map((r) => r.url)).toEqual(['https://x/users/42'])
    expect((await col.searchRequests(db, ws, 'USERS/4')).length).toBe(1)
  })

  it('ротация истории до 1000 записей', async () => {
    const entry = {
      draft: emptyDraft(),
      status: 200,
      durationMs: 1,
      sizeBytes: 1,
      responseHeaders: [] as [string, string][],
      responseBodyPreview: ''
    }
    await pool.query(
      `insert into history (request_snapshot_json, method, url, created_at)
       select $1::jsonb, 'GET', 'http://bulk/' || g, now() - (g || ' seconds')::interval from generate_series(1, 1005) g`,
      [JSON.stringify(entry.draft)]
    )
    await hist.addHistory(db, { ...entry, draft: { ...emptyDraft(), url: 'http://latest' } })
    const list = await hist.listHistory(db)
    expect(list).toHaveLength(1000)
    expect(list[0].url).toBe('http://latest')
  })
})
