import type { Api } from '../../src/shared/ipc'

declare global {
  const window: { api: Api }
}

export {}
