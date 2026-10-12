import { asc } from 'drizzle-orm'
import { workspaces } from '../schema'
import type { Db } from '../types'

/** Возвращает id рабочего пространства по умолчанию, создавая его при первом запуске */
export async function ensureDefaultWorkspace(db: Db): Promise<string> {
  const existing = await db.select({ id: workspaces.id }).from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1)
  if (existing[0]) return existing[0].id
  const [row] = await db.insert(workspaces).values({ name: 'Default' }).returning({ id: workspaces.id })
  return row.id
}
