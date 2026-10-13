import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { join, resolve } from 'node:path'
import { e2eDbUrl } from './env'

const root = resolve(__dirname, '../..')

export interface RestlessApp {
  app: ElectronApplication
  page: Page
  userData: string
  errors: string[]
}

async function resetDb(): Promise<void> {
  const client = new pg.Client({ connectionString: e2eDbUrl() })
  await client.connect()
  try {
    const exists = await client.query(`select to_regclass('public.workspaces') as t`)
    if (exists.rows[0].t) {
      await client.query(
        'TRUNCATE workspaces, collections, folders, requests, environments, variables, history, open_tabs CASCADE'
      )
    }
  } finally {
    await client.end()
  }
}

export async function launch(userData?: string): Promise<RestlessApp> {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'restless-e2e-'))
  if (!userData) {
    await resetDb()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ ui: { language: 'ru', theme: 'light' } }))
  }
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: e2eDbUrl(),
      RESTLESS_USER_DATA: dir,
      RESTLESS_DISABLE_UPDATES: '1'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await expect(page.getByTestId('url-input')).toBeVisible({ timeout: 30_000 })
  return { app, page, userData: dir, errors }
}

export async function chooseMenuItem(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const original = Menu.prototype.popup
    Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
      Menu.prototype.popup = original
      const item = this.items.find((i) => i.label === wanted)
      if (!item) throw new Error(`Menu item "${wanted}" not found`)
      item.click()
      opts?.callback?.()
    }
  }, label)
}

export async function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

export async function writeClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
}

export async function typeInto(page: Page, locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  await locator.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(text)
}

export const test = base.extend<{ restless: RestlessApp }>({
  restless: async ({}, use) => {
    const r = await launch()
    await use(r)
    await r.app.close().catch(() => undefined)
  }
})

export { expect }
