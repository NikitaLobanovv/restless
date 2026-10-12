import type { Api } from '../../src/shared/ipc'

// В page.evaluate() код выполняется в renderer, где preload выставил window.api
declare global {
  const window: { api: Api }
}

export {}
