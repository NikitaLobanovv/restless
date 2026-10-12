import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import type { EnvironmentInfo, VariableInput, VariableScope, VariableView } from '../../../shared/model'
import type { VariableLayer } from '../../../shared/variables'
import type { SecretCodec } from '../../secrets'
import { environments, variables } from '../schema'
import type { Db } from '../types'
import { NotFoundError } from './collections'

/* ---------- Окружения ---------- */

export async function listEnvironments(db: Db, workspaceId: string): Promise<EnvironmentInfo[]> {
  return db
    .select({ id: environments.id, name: environments.name, isActive: environments.isActive })
    .from(environments)
    .where(eq(environments.workspaceId, workspaceId))
    .orderBy(asc(environments.createdAt))
}

export async function createEnvironment(db: Db, workspaceId: string, name: string): Promise<string> {
  const [row] = await db.insert(environments).values({ workspaceId, name }).returning({ id: environments.id })
  return row.id
}

export async function renameEnvironment(db: Db, id: string, name: string): Promise<void> {
  const res = await db
    .update(environments)
    .set({ name })
    .where(eq(environments.id, id))
    .returning({ id: environments.id })
  if (res.length === 0) throw new NotFoundError('Environment')
}

export async function deleteEnvironment(db: Db, id: string): Promise<void> {
  await db.delete(environments).where(eq(environments.id, id))
}

export async function setActiveEnvironment(db: Db, workspaceId: string, id: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(environments).set({ isActive: false }).where(eq(environments.workspaceId, workspaceId))
    if (id) {
      const res = await tx
        .update(environments)
        .set({ isActive: true })
        .where(and(eq(environments.id, id), eq(environments.workspaceId, workspaceId)))
        .returning({ id: environments.id })
      if (res.length === 0) throw new NotFoundError('Environment')
    }
  })
}

export async function getActiveEnvironmentId(db: Db, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.workspaceId, workspaceId), eq(environments.isActive, true)))
    .limit(1)
  return row?.id ?? null
}

/* ---------- Переменные ---------- */

function toView(row: typeof variables.$inferSelect): VariableView {
  return {
    id: row.id,
    key: row.key,
    // значение секрета никогда не покидает main-процесс
    value: row.isSecret ? null : row.value,
    isSecret: row.isSecret,
    hasValue: row.value !== ''
  }
}

export async function listVariables(db: Db, scope: VariableScope, scopeId: string): Promise<VariableView[]> {
  const rows = await db
    .select()
    .from(variables)
    .where(and(eq(variables.scope, scope), eq(variables.scopeId, scopeId)))
    .orderBy(asc(variables.sortOrder), asc(variables.key))
  return rows.map(toView)
}

/**
 * Заменяет набор переменных области целиком (одна транзакция).
 * Для секрета `value === undefined` означает «оставить сохранённое значение».
 */
export async function saveVariables(
  db: Db,
  scope: VariableScope,
  scopeId: string,
  input: VariableInput[],
  codec: SecretCodec
): Promise<VariableView[]> {
  const keys = new Set<string>()
  for (const v of input) {
    if (keys.has(v.key)) throw new Error(`Duplicate variable "${v.key}"`)
    keys.add(v.key)
  }
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(variables)
      .where(and(eq(variables.scope, scope), eq(variables.scopeId, scopeId)))
    const byId = new Map(existing.map((r) => [r.id, r]))
    const keepIds = input.map((v) => v.id).filter((id): id is string => !!id && byId.has(id))

    const where = and(eq(variables.scope, scope), eq(variables.scopeId, scopeId))
    await tx.delete(variables).where(keepIds.length ? and(where, notInArray(variables.id, keepIds)) : where)
    // временно уводим ключи, чтобы перестановки не конфликтовали с уникальным индексом
    if (keepIds.length) {
      for (const id of keepIds) {
        await tx
          .update(variables)
          .set({ key: `__tmp__${id}` })
          .where(eq(variables.id, id))
      }
    }

    for (const [i, v] of input.entries()) {
      const prev = v.id ? byId.get(v.id) : undefined
      let stored: string
      if (v.isSecret) {
        if (v.value !== undefined) stored = v.value === '' ? '' : codec.encrypt(v.value)
        else if (prev) stored = prev.isSecret ? prev.value : prev.value === '' ? '' : codec.encrypt(prev.value)
        else stored = ''
      } else {
        // секрет → обычная: старое значение не раскрываем, если новое не передано
        stored = v.value ?? (prev && !prev.isSecret ? prev.value : '')
      }
      const values = { scope, scopeId, key: v.key, value: stored, isSecret: v.isSecret, sortOrder: i }
      if (prev) await tx.update(variables).set(values).where(eq(variables.id, prev.id))
      else await tx.insert(variables).values(values)
    }
  })
  return listVariables(db, scope, scopeId)
}

export interface ResolvedLayers {
  /** [окружение, коллекция, глобальные] — в порядке приоритета */
  layers: VariableLayer[]
  sources: { scope: VariableScope; secretKeys: Set<string> }[]
  /** Расшифрованные значения секретов — для маскирования в истории */
  secretValues: string[]
}

export async function loadVariableLayers(
  db: Db,
  workspaceId: string,
  collectionId: string | null,
  codec: SecretCodec
): Promise<ResolvedLayers> {
  const envId = await getActiveEnvironmentId(db, workspaceId)
  const scopes: { scope: VariableScope; id: string | null }[] = [
    { scope: 'environment', id: envId },
    { scope: 'collection', id: collectionId },
    { scope: 'global', id: workspaceId }
  ]
  const ids = scopes.map((s) => s.id).filter((x): x is string => !!x)
  const rows = ids.length
    ? await db.select().from(variables).where(inArray(variables.scopeId, ids)).orderBy(asc(variables.sortOrder))
    : []
  const secretValues: string[] = []
  const layers: VariableLayer[] = []
  const sources: ResolvedLayers['sources'] = []
  for (const s of scopes) {
    const layer: VariableLayer = {}
    const secretKeys = new Set<string>()
    for (const r of rows) {
      if (r.scope !== s.scope || r.scopeId !== s.id) continue
      let value = r.value
      if (r.isSecret) {
        try {
          value = codec.decrypt(r.value)
        } catch {
          value = ''
        }
        secretKeys.add(r.key)
        if (value) secretValues.push(value)
      }
      layer[r.key] = value
    }
    layers.push(layer)
    sources.push({ scope: s.scope, secretKeys })
  }
  return { layers, sources, secretValues }
}
