import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UiConfig } from '../shared/model'

/**
 * Локальные настройки приложения (не в БД: они нужны ещё до подключения к ней).
 * Хранятся в userData/config.json, запись атомарная (tmp + rename).
 */
interface StoredConfig {
  ui: UiConfig
  /** Строка подключения, введённая на экране подключения, — зашифрована safeStorage */
  dbUrlEncrypted: string | null
  /** Файлы, выбранные пользователем через системный диалог (разрешены для отправки) */
  allowedFiles: string[]
}

export const DEFAULT_UI: UiConfig = {
  theme: 'system',
  language: 'ru',
  sidebarWidth: 280,
  sidebarCollapsed: false,
  responseLayout: 'right',
  splitRatio: 0.5,
  updateChannel: 'stable'
}

const DEFAULTS: StoredConfig = { ui: DEFAULT_UI, dbUrlEncrypted: null, allowedFiles: [] }

let cache: StoredConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): StoredConfig {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<StoredConfig>
    cache = {
      ui: { ...DEFAULT_UI, ...(raw.ui ?? {}) },
      dbUrlEncrypted: typeof raw.dbUrlEncrypted === 'string' ? raw.dbUrlEncrypted : null,
      allowedFiles: Array.isArray(raw.allowedFiles) ? raw.allowedFiles.filter((f) => typeof f === 'string') : []
    }
  } catch {
    cache = structuredClone(DEFAULTS)
    const lang = app.getLocale().toLowerCase()
    cache.ui.language = lang.startsWith('ru') ? 'ru' : 'en'
  }
  return cache
}

export function saveConfig(patch: Partial<StoredConfig>): StoredConfig {
  const next = { ...loadConfig(), ...patch }
  cache = next
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, file)
  return next
}

export function getUiConfig(): UiConfig {
  return loadConfig().ui
}

export function updateUiConfig(patch: Partial<UiConfig>): UiConfig {
  const ui = { ...loadConfig().ui, ...patch }
  saveConfig({ ui })
  return ui
}
