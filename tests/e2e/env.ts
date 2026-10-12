export const adminUrl = process.env.DATABASE_URL ?? 'postgres://restless:change-me@localhost:5432/restless'
export const E2E_DB = 'restless_e2e'
export const ECHO = process.env.ECHO_URL ?? `http://127.0.0.1:${process.env.ECHO_PORT ?? '8080'}`

export function e2eDbUrl(): string {
  const u = new URL(adminUrl)
  u.pathname = `/${E2E_DB}`
  return u.toString()
}
