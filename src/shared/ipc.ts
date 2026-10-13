import { z } from 'zod'
import type { AppEvent, Channel, MenuAction } from './ipc-channels'
import {
  RequestDraftSchema,
  UiConfigPatchSchema,
  VARIABLE_SCOPES,
  VariableInputSchema,
  type CollectionNode,
  type DbStatus,
  type EnvironmentInfo,
  type HistoryDetail,
  type HistoryItem,
  type HttpResult,
  type OpenTabState,
  type RequestSummary,
  type SavedRequest,
  type UiConfig,
  type VariableHint,
  type VariableView
} from './model'

const id = z.string().uuid()
const name = z.string().trim().min(1).max(200)
const none = z.void()

const out = <T>(): T => undefined as T

function def<I extends z.ZodType, O>(input: I, output: O): { input: I; output: O } {
  return { input, output }
}

export const OpenTabStateSchema = z.object({
  id: id,
  requestId: id.nullable(),
  collectionId: id.nullable(),
  draft: RequestDraftSchema,
  savedDraft: RequestDraftSchema.nullable(),
  position: z.number().int().min(0),
  isActive: z.boolean()
})

export interface AppInfo {
  version: string
  platform: string
  isDev: boolean
  weakSecretStorage: boolean
  secretStorageAvailable: boolean
}

export interface RequestSearchResult extends RequestSummary {
  collectionName: string
}

export const contract = {
  'app:info': def(none, out<AppInfo>()),
  'config:get': def(none, out<UiConfig>()),
  'config:set': def(UiConfigPatchSchema, out<UiConfig>()),

  'db:status': def(none, out<DbStatus>()),
  'db:connect': def(z.object({ url: z.string().min(1).max(2000) }), out<DbStatus>()),
  'db:retry': def(none, out<DbStatus>()),

  'http:send': def(
    z.object({ requestId: z.string().min(1).max(100), draft: RequestDraftSchema, collectionId: id.nullable() }),
    out<HttpResult>()
  ),
  'http:cancel': def(z.object({ requestId: z.string().min(1).max(100) }), out<void>()),
  'http:saveBody': def(z.object({ responseId: z.string().min(1) }), out<boolean>()),
  'http:copyBody': def(z.object({ responseId: z.string().min(1) }), out<boolean>()),

  'collections:tree': def(none, out<CollectionNode[]>()),
  'collections:create': def(z.object({ name }), out<{ id: string }>()),
  'collections:rename': def(z.object({ id, name }), out<void>()),
  'collections:delete': def(z.object({ id }), out<void>()),

  'folders:create': def(z.object({ collectionId: id, parentId: id.nullable(), name }), out<{ id: string }>()),
  'folders:rename': def(z.object({ id, name }), out<void>()),
  'folders:delete': def(z.object({ id }), out<void>()),
  'folders:move': def(
    z.object({ id, collectionId: id, parentId: id.nullable(), index: z.number().int().min(0) }),
    out<void>()
  ),

  'requests:get': def(z.object({ id }), out<SavedRequest | null>()),
  'requests:save': def(
    z.object({
      id: id.optional(),
      collectionId: id,
      folderId: id.nullable(),
      draft: RequestDraftSchema
    }),
    out<SavedRequest>()
  ),
  'requests:rename': def(z.object({ id, name }), out<void>()),
  'requests:delete': def(z.object({ id }), out<void>()),
  'requests:duplicate': def(z.object({ id }), out<RequestSummary>()),
  'requests:move': def(
    z.object({ id, collectionId: id, folderId: id.nullable(), index: z.number().int().min(0) }),
    out<void>()
  ),
  'requests:search': def(z.object({ query: z.string().max(500) }), out<RequestSearchResult[]>()),

  'environments:list': def(none, out<EnvironmentInfo[]>()),
  'environments:create': def(z.object({ name }), out<{ id: string }>()),
  'environments:rename': def(z.object({ id, name }), out<void>()),
  'environments:delete': def(z.object({ id }), out<void>()),
  'environments:setActive': def(z.object({ id: id.nullable() }), out<void>()),

  'variables:list': def(z.object({ scope: z.enum(VARIABLE_SCOPES), scopeId: id.nullable() }), out<VariableView[]>()),
  'variables:save': def(
    z.object({
      scope: z.enum(VARIABLE_SCOPES),
      scopeId: id.nullable(),
      variables: z.array(VariableInputSchema).max(1000)
    }),
    out<VariableView[]>()
  ),
  'variables:hints': def(z.object({ collectionId: id.nullable() }), out<Record<string, VariableHint>>()),

  'history:list': def(z.object({ query: z.string().max(500).optional() }), out<HistoryItem[]>()),
  'history:get': def(z.object({ id }), out<HistoryDetail | null>()),
  'history:delete': def(z.object({ id }), out<void>()),
  'history:clear': def(none, out<void>()),

  'tabs:load': def(none, out<OpenTabState[]>()),
  'tabs:save': def(z.object({ tabs: z.array(OpenTabStateSchema).max(200) }), out<void>()),

  'curl:copy': def(
    z.object({ draft: RequestDraftSchema, collectionId: id.nullable() }),
    out<{ copied: boolean; includedSecrets: boolean }>()
  ),

  'files:pick': def(z.object({ multiple: z.boolean().default(false) }), out<string[]>()),
  'files:saveText': def(z.object({ defaultName: z.string().max(200), text: z.string() }), out<boolean>()),

  'menu:popup': def(
    z.object({
      items: z
        .array(
          z.object({
            id: z.string().max(100),
            label: z.string().max(200),
            enabled: z.boolean().optional(),
            type: z.enum(['normal', 'separator']).optional()
          })
        )
        .max(50)
    }),
    out<string | null>()
  )
} satisfies Record<Channel, { input: z.ZodType; output: unknown }>

export type Contract = typeof contract
export type ChannelInput<C extends Channel> = z.input<Contract[C]['input']>
export type ChannelParsedInput<C extends Channel> = z.output<Contract[C]['input']>
export type ChannelOutput<C extends Channel> = Contract[C]['output']

type Namespace<C extends string> = C extends `${infer N}:${string}` ? N : never
type Method<C extends string, N extends string> = C extends `${N}:${infer M}` ? M : never

export type Api = {
  [N in Namespace<Channel>]: {
    [M in Method<Channel, N>]: `${N}:${M}` extends infer C extends Channel
      ? (input: ChannelInput<C>) => Promise<ChannelOutput<C>>
      : never
  }
} & {
  on(event: 'menu:action', cb: (action: MenuAction) => void): () => void
  on(event: 'config:changed', cb: (config: UiConfig) => void): () => void
  on(event: 'app:beforeQuit', cb: () => void): () => void
  on(event: AppEvent, cb: (payload: never) => void): () => void
}
