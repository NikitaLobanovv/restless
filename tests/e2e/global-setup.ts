import pg from 'pg'
import { E2E_DB, adminUrl } from './env'

/** Чистая БД для e2e: приложение само применит к ней миграции при старте */
export default async function globalSetup(): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl })
  await client.connect()
  await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`)
  await client.query(`CREATE DATABASE ${E2E_DB}`)
  await client.end()
}
