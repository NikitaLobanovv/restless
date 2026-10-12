// Применяет SQL-миграции из ./drizzle тем же мигратором, что и приложение при старте.
// В отличие от `drizzle-kit migrate`, печатает причину ошибки и подсказку.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const HINTS = {
  '28P01':
    'Пароль не подошёл. POSTGRES_PASSWORD применяется только при первом создании тома pgdata: ' +
    'если вы поменяли его в .env позже, верните прежний пароль или смените его в БД ' +
    '(make psql → ALTER USER ... PASSWORD ...), либо пересоздайте БД с потерей данных: make reset.',
  '3D000': 'База данных не существует — проверьте POSTGRES_DB в .env или пересоздайте том: make reset.',
  ECONNREFUSED: 'PostgreSQL недоступен — запустите его: make db.'
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 })
try {
  await migrate(drizzle(pool), {
    migrationsFolder: './drizzle',
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public'
  })
  console.log('✓ Миграции применены')
} catch (err) {
  const cause = err.cause ?? err
  console.error(`✗ Не удалось применить миграции: ${cause.message}`)
  const hint = HINTS[cause.code]
  if (hint) console.error(`  ${hint}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
