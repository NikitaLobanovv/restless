import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn
} from 'drizzle-orm/pg-core'
import type { KeyValue, RequestBody, RequestDraft, RequestSettings } from '../../shared/model'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt()
})

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Переменные коллекции живут в таблице variables (scope = collection);
    // поле оставлено по ТЗ для импорта/экспорта и задела на будущее.
    variablesJson: jsonb('variables_json').$type<Record<string, unknown>>().notNull().default({}),
    authJson: jsonb('auth_json').$type<Record<string, unknown> | null>(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt()
  },
  (t) => [index('collections_workspace_id_idx').on(t.workspaceId)]
)

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (t) => [index('folders_collection_id_idx').on(t.collectionId), index('folders_parent_id_idx').on(t.parentId)]
)

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull().default(''),
    paramsJson: jsonb('params_json').$type<KeyValue[]>().notNull().default([]),
    headersJson: jsonb('headers_json').$type<KeyValue[]>().notNull().default([]),
    bodyType: text('body_type').notNull().default('none'),
    body: jsonb('body').$type<RequestBody>().notNull(),
    authJson: jsonb('auth_json').$type<Record<string, unknown> | null>(),
    settingsJson: jsonb('settings_json').$type<RequestSettings>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('requests_collection_id_idx').on(t.collectionId),
    index('requests_folder_id_idx').on(t.folderId),
    index('requests_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
    index('requests_url_trgm_idx').using('gin', sql`${t.url} gin_trgm_ops`)
  ]
)

export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: createdAt()
  },
  (t) => [index('environments_workspace_id_idx').on(t.workspaceId)]
)

export const variableScope = pgEnum('variable_scope', ['global', 'environment', 'collection'])

export const variables = pgTable(
  'variables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: variableScope('scope').notNull(),
    /** id окружения или коллекции; для global — id рабочего пространства */
    scopeId: uuid('scope_id').notNull(),
    key: text('key').notNull(),
    /** Для секретов: `enc:v1:<base64>` (safeStorage) */
    value: text('value').notNull().default(''),
    isSecret: boolean('is_secret').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (t) => [
    index('variables_scope_idx').on(t.scope, t.scopeId),
    uniqueIndex('variables_scope_key_uq').on(t.scope, t.scopeId, t.key)
  ]
)

export const history = pgTable(
  'history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestSnapshotJson: jsonb('request_snapshot_json').$type<RequestDraft>().notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    status: integer('status'),
    durationMs: integer('duration_ms'),
    sizeBytes: integer('size_bytes'),
    responseHeadersJson: jsonb('response_headers_json').$type<[string, string][]>().notNull().default([]),
    responseBodyPreview: text('response_body_preview').notNull().default(''),
    createdAt: createdAt()
  },
  (t) => [index('history_created_at_idx').on(t.createdAt)]
)

export const openTabs = pgTable(
  'open_tabs',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
    draftJson: jsonb('draft_json').$type<RequestDraft>().notNull(),
    savedDraftJson: jsonb('saved_draft_json').$type<RequestDraft | null>(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(false)
  },
  (t) => [index('open_tabs_request_id_idx').on(t.requestId)]
)
