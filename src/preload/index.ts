import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENTS, type AppEvent } from '../shared/ipc-channels'

const api: Record<string, unknown> = {}

for (const channel of CHANNELS) {
  const [ns, method] = channel.split(':')
  const group = (api[ns] ??= {}) as Record<string, (input?: unknown) => Promise<unknown>>
  group[method] = (input?: unknown) => ipcRenderer.invoke(channel, input)
}

api.on = (event: AppEvent, cb: (payload: unknown) => void): (() => void) => {
  if (!EVENTS.includes(event)) throw new Error(`Unknown event ${String(event)}`)
  if (typeof cb !== 'function') throw new Error('Callback must be a function')
  const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
