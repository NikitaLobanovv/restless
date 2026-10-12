import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { resolve } from 'node:path'
import * as schema from '../../src/main/db/schema'
import type { Db } from '../../src/main/db/types'
import { ensureDefaultWorkspace } from '../../src/main/db/repos/workspace'
import type { SecretCodec } from '../../src/main/secrets'

export const migrationsFolder = resolve(__dirname, '../../drizzle')

/** In-memory PostgreSQL (PGlite) с теми же миграциями, что и в приложении */
export async function createTestDb(): Promise<{ db: Db; workspaceId: string; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm } })
  const db = drizzle(client, { schema }) as unknown as Db
  await migrate(drizzle(client), {
    migrationsFolder,
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public'
  })
  const workspaceId = await ensureDefaultWorkspace(db)
  return { db, workspaceId, close: () => client.close() }
}

/** Тестовый «шифр»: формат как у safeStorage-кодека, но без ОС */
export const fakeCodec: SecretCodec = {
  encrypt: (plain) => `enc:v1:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (stored) => (stored.startsWith('enc:v1:') ? Buffer.from(stored.slice(7), 'base64').toString('utf8') : stored)
}
