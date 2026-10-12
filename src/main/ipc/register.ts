import { ipcMain, type IpcMainInvokeEvent, type WebFrameMain } from 'electron'
import { z } from 'zod'
import { contract, type ChannelOutput, type ChannelParsedInput } from '../../shared/ipc'
import { CHANNELS, type Channel } from '../../shared/ipc-channels'
import { log } from '../log'
import { isTrustedUrl } from '../security'

const registered = new Set<Channel>()

function isTrustedSender(frame: WebFrameMain | null): boolean {
  // только главный фрейм нашего окна; iframe предпросмотра HTML сюда не попадёт
  if (!frame || frame.parent !== null) return false
  return isTrustedUrl(frame.url)
}

type Handler<C extends Channel> = (
  input: ChannelParsedInput<C>,
  event: IpcMainInvokeEvent
) => Promise<ChannelOutput<C>> | ChannelOutput<C>

/**
 * Регистрирует обработчик канала: проверка отправителя → zod-валидация → вызов.
 * Ошибки возвращаются renderer'у только текстом, без стека.
 */
export function handle<C extends Channel>(channel: C, fn: Handler<C>): void {
  if (registered.has(channel)) throw new Error(`IPC channel ${channel} registered twice`)
  registered.add(channel)
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
      log.warn(`Rejected IPC ${channel} from untrusted sender`, event.senderFrame?.url)
      throw new Error('Untrusted sender')
    }
    const schema = contract[channel].input as z.ZodType
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Invalid input for ${channel}: ${z.prettifyError(parsed.error)}`)
    }
    try {
      return await fn(parsed.data as ChannelParsedInput<C>, event)
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      if (message !== 'DB_UNAVAILABLE') log.error(`IPC ${channel} failed:`, message)
      throw new Error(message)
    }
  })
}

export function assertAllChannelsRegistered(): void {
  const missing = CHANNELS.filter((c) => !registered.has(c))
  if (missing.length) throw new Error(`IPC channels without handlers: ${missing.join(', ')}`)
}
