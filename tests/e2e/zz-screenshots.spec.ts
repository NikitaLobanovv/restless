import { ECHO } from './env'
import { chooseMenuItem, expect, launch, typeInto } from './fixtures'
import { test } from '@playwright/test'

// Скриншоты для README: запускается вручную (SCREENSHOTS=1)
test.skip(!process.env.SCREENSHOTS, 'только по запросу')

test('скриншоты', async () => {
  const r = await launch()
  const { page, app } = r
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 860))
  await page.getByTestId('collection-create').click()
  await page.getByTestId('prompt-input').fill('Petstore API')
  await page.getByTestId('prompt-ok').click()
  for (const f of ['Pets', 'Orders']) {
    await chooseMenuItem(app, 'Новая папка')
    await page.getByTestId('tree-collection').click({ button: 'right' })
    await page.getByTestId('prompt-input').fill(f)
    await page.getByTestId('prompt-ok').click()
  }
  await page.getByTestId('method-select').selectOption('POST')
  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/anything/pets?limit=10`)
  await page.getByRole('tab', { name: /^Тело/ }).click()
  await page.getByRole('radio', { name: 'JSON' }).check()
  await typeInto(page, page.getByTestId('body-editor'), '{\n  "name": "Rex",\n  "tags": ["dog", "good boy"]\n}')
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByTestId('save-name').fill('Create pet')
  await page.getByTestId('save-target').selectOption({ label: 'Petstore API / Pets' })
  await page.getByTestId('save-ok').click()
  await page.getByTestId('tree-folder').filter({ hasText: 'Pets' }).click()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('response-status')).toHaveText(/200/)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'docs/screenshots/main-light.png' })
  await page.getByRole('combobox', { name: 'Тема' }).selectOption('dark')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'docs/screenshots/main-dark.png' })
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await page.screenshot({ path: 'docs/screenshots/timeline-dark.png' })
  await app.close()
})
