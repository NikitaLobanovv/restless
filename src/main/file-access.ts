import { resolve } from 'node:path'
import { loadConfig, saveConfig } from './config'

const MAX_ALLOWED = 2000

export function allowFiles(paths: string[]): void {
  const cur = loadConfig().allowedFiles
  const next = [...new Set([...paths.map((p) => resolve(p)), ...cur])].slice(0, MAX_ALLOWED)
  saveConfig({ allowedFiles: next })
}

export function isFileAllowed(path: string): boolean {
  return loadConfig().allowedFiles.includes(resolve(path))
}

export class FileNotAllowedError extends Error {
  constructor(path: string) {
    super(`File was not selected via the file dialog: ${path}. Pick it again.`)
    this.name = 'FileNotAllowedError'
  }
}

export function assertFileAllowed(path: string): void {
  if (!isFileAllowed(path)) throw new FileNotAllowedError(path)
}
