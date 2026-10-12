import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://restless:change-me@localhost:5432/restless'
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public'
  }
})
