import { z } from 'zod'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const KeyValueSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  description: z.string().default(''),
  enabled: z.boolean().default(true)
})
export type KeyValue = z.infer<typeof KeyValueSchema>

export const FormFieldSchema = KeyValueSchema.extend({
  kind: z.enum(['text', 'file']).default('text'),
  files: z.array(z.string()).default([])
})
export type FormField = z.infer<typeof FormFieldSchema>

export const BODY_TYPES = ['none', 'json', 'text', 'xml', 'urlencoded', 'multipart', 'binary'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export const RequestBodySchema = z.object({
  type: z.enum(BODY_TYPES).default('none'),
  raw: z.string().default(''),
  urlencoded: z.array(KeyValueSchema).default([]),
  multipart: z.array(FormFieldSchema).default([]),
  binaryPath: z.string().nullable().default(null)
})
export type RequestBody = z.infer<typeof RequestBodySchema>

export const RequestSettingsSchema = z.object({
  timeoutMs: z.number().int().min(0).max(3_600_000).default(30_000),
  followRedirects: z.boolean().default(true),
  verifySsl: z.boolean().default(true)
})
export type RequestSettings = z.infer<typeof RequestSettingsSchema>

export const RequestDraftSchema = z.object({
  name: z.string().max(500).default('New request'),
  method: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'invalid method'),
  url: z.string().max(100_000).default(''),
  params: z.array(KeyValueSchema).default([]),
  headers: z.array(KeyValueSchema).default([]),
  body: RequestBodySchema.default(RequestBodySchema.parse({})),
  settings: RequestSettingsSchema.default(RequestSettingsSchema.parse({}))
})
export type RequestDraft = z.infer<typeof RequestDraftSchema>

export function emptyDraft(): RequestDraft {
  return RequestDraftSchema.parse({ method: 'GET' })
}

export interface TimelinePhases {
  dnsMs?: number
  tcpMs?: number
  tlsMs?: number
  ttfbMs?: number
  downloadMs?: number
}

export interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  maxAge?: string
  httpOnly: boolean
  secure: boolean
  sameSite?: string
}

export interface HttpResponseData {
  responseId: string
  status: number
  statusText: string
  url: string
  headers: [string, string][]
  cookies: ResponseCookie[]
  durationMs: number
  sizeBytes: number
  contentType: string
  bodyText: string
  imageDataUrl: string | null
  isLarge: boolean
  truncated: boolean
  timeline: TimelinePhases
  redirects: string[]
}

export interface HttpErrorData {
  error: true
  code: 'TIMEOUT' | 'CANCELLED' | 'NETWORK' | 'TLS' | 'INVALID_URL' | 'FILE' | 'UNKNOWN'
  message: string
  durationMs: number
}

export type HttpResult = HttpResponseData | HttpErrorData

export interface CollectionNode {
  id: string
  name: string
  folders: FolderNode[]
  requests: RequestSummary[]
}

export interface FolderNode {
  id: string
  collectionId: string
  parentId: string | null
  name: string
  sortOrder: number
  folders: FolderNode[]
  requests: RequestSummary[]
}

export interface RequestSummary {
  id: string
  collectionId: string
  folderId: string | null
  name: string
  method: string
  url: string
  sortOrder: number
}

export interface SavedRequest extends RequestSummary {
  draft: RequestDraft
  updatedAt: string
}

export interface EnvironmentInfo {
  id: string
  name: string
  isActive: boolean
}

export const VARIABLE_SCOPES = ['global', 'environment', 'collection'] as const
export type VariableScope = (typeof VARIABLE_SCOPES)[number]

export interface VariableView {
  id: string
  key: string
  value: string | null
  isSecret: boolean
  hasValue: boolean
}

export const VariableInputSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().min(1).max(200),
  value: z.string().max(100_000).optional(),
  isSecret: z.boolean().default(false)
})
export type VariableInput = z.infer<typeof VariableInputSchema>

export interface VariableHint {
  value: string
  source: VariableScope
  isSecret: boolean
}

export interface HistoryItem {
  id: string
  method: string
  url: string
  status: number | null
  durationMs: number | null
  sizeBytes: number | null
  createdAt: string
}

export interface HistoryDetail extends HistoryItem {
  draft: RequestDraft
  responseHeaders: [string, string][]
  responseBodyPreview: string
}

export interface OpenTabState {
  id: string
  requestId: string | null
  collectionId: string | null
  draft: RequestDraft
  savedDraft: RequestDraft | null
  position: number
  isActive: boolean
}

export const THEMES = ['system', 'light', 'dark'] as const
export type ThemeSource = (typeof THEMES)[number]
export const LANGUAGES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export interface UiConfig {
  theme: ThemeSource
  language: Language
  sidebarWidth: number
  sidebarCollapsed: boolean
  responseLayout: 'right' | 'bottom'
  splitRatio: number
  updateChannel: 'stable' | 'beta'
}

export const UiConfigPatchSchema = z
  .object({
    theme: z.enum(THEMES),
    language: z.enum(LANGUAGES),
    sidebarWidth: z.number().min(160).max(800),
    sidebarCollapsed: z.boolean(),
    responseLayout: z.enum(['right', 'bottom']),
    splitRatio: z.number().min(0.15).max(0.85),
    updateChannel: z.enum(['stable', 'beta'])
  })
  .partial()

export interface DbStatus {
  connected: boolean
  error: string | null
}

export interface ContextMenuItem {
  id: string
  label: string
  enabled?: boolean
  type?: 'normal' | 'separator'
}
