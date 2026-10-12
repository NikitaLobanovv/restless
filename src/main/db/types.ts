import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'

/** Любая drizzle-БД с нашей схемой: node-postgres в приложении, PGlite в unit-тестах */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
