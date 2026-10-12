import type { Api } from '@shared/ipc'

export const api: Api = window.api

/** Убирает служебный префикс Electron из текста ошибки IPC */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function isDbUnavailable(err: unknown): boolean {
  return errorMessage(err) === 'DB_UNAVAILABLE'
}
