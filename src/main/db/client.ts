import { app, safeStorage } from 'electron'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { join } from 'node:path'
import pg from 'pg'
import type { DbStatus } from '../../shared/model'
import { loadConfig, saveConfig } from '../config'
import { log } from '../log'
import * as schema from './schema'
import type { Db } from './types'
import { ensureDefaultWorkspace } from './repos/workspace'

const DEFAULT_URL = 'postgres://restless:change-me@localhost:5432/restless'

let pool: pg.Pool | null = null
let db: Db | null = null
let workspaceId: string | null = null
let status: DbStatus = { connected: false, error: null }

export class DbUnavailableError extends Error {
  constructor() {
    super('DB_UNAVAILABLE')
  }
}

export function migrationsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}

function sanitize(message: string, url: string): string {
  try {
    const u = new URL(url)
    if (u.password) return message.split(u.password).join('***')
  } catch {}
  return message
}

async function tryConnect(url: string): Promise<void> {
  const next = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30_000,
    application_name: 'restless'
  })
  next.on('error', (err) => {
    log.warn('pg pool error:', sanitize(err.message, url))
    status = { connected: false, error: 'Connection lost' }
  })
  try {
    const client = await next.connect()
    client.release()
    const nextDb = drizzle(next, { schema }) as unknown as Db
    await migrate(drizzle(next), {
      migrationsFolder: migrationsFolder(),
      migrationsTable: '__drizzle_migrations',
      migrationsSchema: 'public'
    })
    const ws = await ensureDefaultWorkspace(nextDb)
    const prev = pool
    pool = next
    db = nextDb
    workspaceId = ws
    status = { connected: true, error: null }
    if (prev) void prev.end().catch(() => undefined)
  } catch (err) {
    await next.end().catch(() => undefined)
    throw new Error(sanitize((err as Error).message || String(err), url))
  }
}

function savedUrl(): string | null {
  const enc = loadConfig().dbUrlEncrypted
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export async function connectOnStartup(): Promise<DbStatus> {
  const candidates = [savedUrl(), process.env.DATABASE_URL, DEFAULT_URL].filter(
    (u, i, arr): u is string => !!u && arr.indexOf(u) === i
  )
  let lastError = 'No connection string'
  for (const url of candidates) {
    try {
      await tryConnect(url)
      return status
    } catch (err) {
      lastError = (err as Error).message
      log.warn('DB connect failed:', lastError)
    }
  }
  status = { connected: false, error: lastError }
  return status
}

export async function connectWithUrl(url: string): Promise<DbStatus> {
  try {
    await tryConnect(url)
    if (safeStorage.isEncryptionAvailable()) {
      saveConfig({ dbUrlEncrypted: safeStorage.encryptString(url).toString('base64') })
    }
  } catch (err) {
    status = { connected: false, error: (err as Error).message }
  }
  return status
}

export async function retry(): Promise<DbStatus> {
  if (status.connected && pool) {
    try {
      await pool.query('select 1')
      return status
    } catch {}
  }
  return connectOnStartup()
}

export function getStatus(): DbStatus {
  return status
}

export function getDb(): Db {
  if (!db || !status.connected) throw new DbUnavailableError()
  return db
}

export function getWorkspaceId(): string {
  if (!workspaceId) throw new DbUnavailableError()
  return workspaceId
}

export async function closeDb(): Promise<void> {
  const p = pool
  pool = null
  db = null
  if (p) await p.end().catch(() => undefined)
}
