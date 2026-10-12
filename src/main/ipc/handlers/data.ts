import type { VariableHint } from '../../../shared/model'
import { getDb, getWorkspaceId } from '../../db/client'
import * as col from '../../db/repos/collections'
import * as env from '../../db/repos/environments'
import * as hist from '../../db/repos/history'
import * as tabs from '../../db/repos/tabs'
import { t } from '../../i18n'
import { safeStorageCodec } from '../../secrets'
import { handle } from '../register'
import { onTabsSaved } from '../../window'

export function registerDataHandlers(): void {
  /* Коллекции и папки */
  handle('collections:tree', () => col.getTree(getDb(), getWorkspaceId()))
  handle('collections:create', async ({ name }) => ({
    id: await col.createCollection(getDb(), getWorkspaceId(), name)
  }))
  handle('collections:rename', ({ id, name }) => col.renameCollection(getDb(), id, name))
  handle('collections:delete', ({ id }) => col.deleteCollection(getDb(), id))

  handle('folders:create', async (input) => ({ id: await col.createFolder(getDb(), input) }))
  handle('folders:rename', ({ id, name }) => col.renameFolder(getDb(), id, name))
  handle('folders:delete', ({ id }) => col.deleteFolder(getDb(), id))
  handle('folders:move', (input) => col.moveFolder(getDb(), input))

  /* Запросы */
  handle('requests:get', ({ id }) => col.getRequest(getDb(), id))
  handle('requests:save', (input) => col.saveRequest(getDb(), input))
  handle('requests:rename', ({ id, name }) => col.renameRequest(getDb(), id, name))
  handle('requests:delete', ({ id }) => col.deleteRequest(getDb(), id))
  handle('requests:duplicate', ({ id }) => col.duplicateRequest(getDb(), id, t('common.copySuffix')))
  handle('requests:move', (input) => col.moveRequest(getDb(), input))
  handle('requests:search', ({ query }) => col.searchRequests(getDb(), getWorkspaceId(), query))

  /* Окружения */
  handle('environments:list', () => env.listEnvironments(getDb(), getWorkspaceId()))
  handle('environments:create', async ({ name }) => ({
    id: await env.createEnvironment(getDb(), getWorkspaceId(), name)
  }))
  handle('environments:rename', ({ id, name }) => env.renameEnvironment(getDb(), id, name))
  handle('environments:delete', ({ id }) => env.deleteEnvironment(getDb(), id))
  handle('environments:setActive', ({ id }) => env.setActiveEnvironment(getDb(), getWorkspaceId(), id))

  /* Переменные. Для global scopeId — id рабочего пространства, его renderer не знает */
  handle('variables:list', ({ scope, scopeId }) =>
    env.listVariables(getDb(), scope, scope === 'global' ? getWorkspaceId() : requireId(scopeId))
  )
  handle('variables:save', ({ scope, scopeId, variables }) =>
    env.saveVariables(
      getDb(),
      scope,
      scope === 'global' ? getWorkspaceId() : requireId(scopeId),
      variables,
      safeStorageCodec
    )
  )
  handle('variables:hints', async ({ collectionId }) => {
    const res = await env.loadVariableLayers(getDb(), getWorkspaceId(), collectionId, safeStorageCodec)
    const hints: Record<string, VariableHint> = {}
    // от низшего приоритета к высшему, чтобы верхние слои перезаписали нижние
    for (let i = res.layers.length - 1; i >= 0; i--) {
      const src = res.sources[i]
      for (const [key, value] of Object.entries(res.layers[i])) {
        const isSecret = src.secretKeys.has(key)
        hints[key] = { value: isSecret ? '•••••' : value, source: src.scope, isSecret }
      }
    }
    return hints
  })

  /* История */
  handle('history:list', ({ query }) => hist.listHistory(getDb(), query))
  handle('history:get', ({ id }) => hist.getHistory(getDb(), id))
  handle('history:delete', ({ id }) => hist.deleteHistory(getDb(), id))
  handle('history:clear', () => hist.clearHistory(getDb()))

  /* Вкладки */
  handle('tabs:load', () => tabs.loadTabs(getDb()))
  handle('tabs:save', async ({ tabs: list }) => {
    await tabs.saveTabs(getDb(), list)
    onTabsSaved()
  })
}

function requireId(id: string | null): string {
  if (!id) throw new Error('scopeId is required')
  return id
}
