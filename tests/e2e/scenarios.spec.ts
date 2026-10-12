import type { Page } from '@playwright/test'
import { ECHO } from './env'
import {
  chooseMenuItem,
  expect,
  launch,
  readClipboard,
  test,
  typeInto,
  writeClipboard,
  type RestlessApp
} from './fixtures'

/** Текст тела последнего ответа — через кнопку «Копировать ответ» (CodeMirror рисует только видимые строки) */
async function responseText({ app, page }: RestlessApp): Promise<string> {
  await writeClipboard(app, '')
  await page.getByRole('button', { name: 'Копировать ответ' }).click()
  await expect.poll(() => readClipboard(app)).not.toBe('')
  return readClipboard(app)
}

async function sendAndWait(page: Page, status = /200/): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('response-status')).toHaveText(status)
}

async function prompt(page: Page, value: string): Promise<void> {
  const input = page.getByTestId('prompt-input')
  await input.fill(value)
  await page.getByTestId('prompt-ok').click()
  await expect(page.getByTestId('prompt-dialog')).toBeHidden()
}

test('сценарий 1: URL, метод, заголовки, JSON-тело → отформатированный ответ, статус, время, размер', async ({
  restless
}) => {
  const { page, errors } = restless
  await page.getByTestId('method-select').selectOption('POST')
  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/post?source=e2e`)

  // URL → таблица параметров
  await expect(page.getByRole('tab', { name: 'Параметры (1)' })).toBeVisible()

  await page.getByRole('tab', { name: /^Заголовки/ }).click()
  await typeInto(page, page.getByRole('textbox', { name: 'Ключ, строка 1' }), 'X-Test')
  await typeInto(page, page.getByRole('textbox', { name: 'Значение, строка 1' }), 'e2e')

  await page.getByRole('tab', { name: /^Тело/ }).click()
  await page.getByRole('radio', { name: 'JSON' }).check()
  await typeInto(page, page.getByTestId('body-editor'), '{"hello":"world"}')
  // авто Content-Type показан на вкладке заголовков
  await page.getByRole('tab', { name: /^Заголовки/ }).click()
  await expect(page.getByText('application/json', { exact: true })).toBeVisible()

  await sendAndWait(page)
  await expect(page.getByTestId('response-status')).toHaveClass(/status-success/)
  await expect(page.getByTestId('response-time')).toHaveText(/\d+(\.\d+)? (ms|s)/)
  await expect(page.getByTestId('response-size')).toHaveText(/\d+(\.\d+)? (B|KB)/)

  const body = JSON.parse(await responseText(restless))
  expect(body.json).toEqual({ hello: 'world' })
  expect(body.headers['X-Test']).toEqual(['e2e'])
  expect(body.args).toEqual({ source: ['e2e'] })
  // Pretty: тело отформатировано с отступами
  await expect(page.getByTestId('response-body')).toContainText('"args": {')

  // вкладки ответа
  await page
    .getByRole('tab', { name: /^Заголовки \(\d+\)/ })
    .last()
    .click()
  await expect(page.getByRole('cell', { name: 'content-type', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await expect(page.getByText('TCP-соединение')).toBeVisible()

  // 4xx подсвечивается как ошибка клиента
  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/status/404`)
  await page.getByTestId('method-select').selectOption('GET')
  await sendAndWait(page, /404/)
  await expect(page.getByTestId('response-status')).toHaveClass(/status-client/)

  expect(errors).toEqual([])
})

test('сценарий 2: коллекция с папками, сохранение, перетаскивание, поиск; данные переживают перезапуск', async () => {
  let r = await launch()
  const { page, app } = r

  await page.getByTestId('collection-create').click()
  await prompt(page, 'E2E API')
  const collection = page.getByTestId('tree-collection').filter({ hasText: 'E2E API' })
  await expect(collection).toBeVisible()

  for (const folder of ['Users', 'Orders']) {
    await chooseMenuItem(app, 'Новая папка')
    await collection.click({ button: 'right' })
    await prompt(page, folder)
    await expect(page.getByTestId('tree-folder').filter({ hasText: folder })).toBeVisible()
  }

  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/get?user=1`)
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByTestId('save-name').fill('Get user')
  await page.getByTestId('save-target').selectOption({ label: 'E2E API / Users' })
  await page.getByTestId('save-ok').click()
  const request = page.getByTestId('tree-request').filter({ hasText: 'Get user' })
  await expect(request).toBeVisible()
  await expect(page.getByTestId('dirty')).toHaveCount(0)

  // drag-and-drop запроса в другую папку
  await request.dragTo(page.getByTestId('tree-folder').filter({ hasText: 'Orders' }))
  await expect
    .poll(async () => {
      const tree = await page.evaluate(() => window.api.collections.tree())
      const orders = tree[0].folders.find((f) => f.name === 'Orders')
      return orders?.requests.map((x) => x.name) ?? []
    })
    .toEqual(['Get user'])

  // дублирование и поиск по имени/URL
  await chooseMenuItem(app, 'Дублировать')
  await request.first().click({ button: 'right' })
  await expect(page.getByTestId('tree-request')).toHaveCount(2)
  await page.getByRole('searchbox', { name: 'Поиск по имени и URL' }).fill('user=1')
  await expect(page.getByTestId('tree-request')).toHaveCount(2)
  await page.getByRole('searchbox', { name: 'Поиск по имени и URL' }).fill('нет такого')
  await expect(page.getByText('Ничего не найдено')).toBeVisible()

  // несохранённый черновик во второй вкладке
  await page.getByTestId('new-tab').click()
  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/draft-only`)

  const userData = r.userData
  await app.close()

  // «через неделю»: перезапуск
  r = await launch(userData)
  const p2 = r.page
  await expect(p2.getByTestId('tree-collection').filter({ hasText: 'E2E API' })).toBeVisible()
  await p2.getByTestId('tree-folder').filter({ hasText: 'Orders' }).click()
  await expect(p2.getByTestId('tree-request').filter({ hasText: 'Get user' })).toHaveCount(2)
  // сохранённый запрос, его копия (открылась при дублировании) и черновик
  await expect(p2.getByTestId('request-tab')).toHaveCount(3)
  await expect(p2.getByTestId('url-input')).toHaveText(`${ECHO}/draft-only`)
  await expect(p2.getByTestId('dirty')).toHaveCount(1)
  await r.app.close()
})

test('надёжность: черновик переживает аварийное завершение (автосохранение каждые 5 с)', async () => {
  const r = await launch()
  await typeInto(r.page, r.page.getByTestId('url-input'), `${ECHO}/crash-safe`)
  await r.page.waitForTimeout(6000)
  r.app.process().kill('SIGKILL')

  const again = await launch(r.userData)
  await expect(again.page.getByTestId('url-input')).toHaveText(`${ECHO}/crash-safe`)
  await again.app.close()
})

test('сценарий 3: переключение окружений подставляет {{baseUrl}}', async ({ restless }) => {
  const { page } = restless
  await page.getByTestId('sidebar-environments').click()

  for (const [name, base] of [
    ['dev', `${ECHO}/anything/dev`],
    ['prod', `${ECHO}/anything/prod`]
  ]) {
    await page.getByTestId('env-create').click()
    await prompt(page, name)
    const modal = page.getByTestId('variables-modal')
    await expect(modal).toBeVisible()
    await modal.getByTestId('var-add').click()
    await modal.getByTestId('var-key').fill('baseUrl')
    await modal.getByTestId('var-value').fill(base)
    await modal.getByTestId('var-add').click()
    await modal.getByTestId('var-key').nth(1).fill('apiToken')
    await modal.getByTestId('var-value').nth(1).fill(`secret-${name}`)
    await modal.getByTestId('var-secret').nth(1).check()
    await modal.getByTestId('variables-save').click()
    await expect(modal).toBeHidden()
  }

  await page.getByTestId('env-select').selectOption({ label: 'dev' })
  await typeInto(page, page.getByTestId('url-input'), '{{baseUrl}}/ping')
  // переменная распознана и подсвечена как определённая
  await expect(page.locator('[data-testid="url-input"] .cm-var-ok')).toHaveText('{{baseUrl}}')

  await page.getByRole('tab', { name: /^Заголовки/ }).click()
  await typeInto(page, page.getByRole('textbox', { name: 'Ключ, строка 1' }), 'Authorization')
  await typeInto(page, page.getByRole('textbox', { name: 'Значение, строка 1' }), 'Bearer {{apiToken}}')

  await sendAndWait(page)
  let body = JSON.parse(await responseText(restless))
  expect(body.url).toContain('/anything/dev/ping')
  expect(body.headers.Authorization).toEqual(['Bearer secret-dev'])

  // Ctrl+E: следующее окружение
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.getByTestId('env-select')).toHaveValue(/.+/)
  await expect(page.getByTestId('env-select').locator('option:checked')).toHaveText('prod')
  await sendAndWait(page)
  body = JSON.parse(await responseText(restless))
  expect(body.url).toContain('/anything/prod/ping')
  expect(body.headers.Authorization).toEqual(['Bearer secret-prod'])

  // неразрешённая переменная подсвечивается
  await typeInto(page, page.getByTestId('url-input'), '{{nope}}/x')
  await expect(page.locator('[data-testid="url-input"] .cm-var-missing')).toHaveText('{{nope}}')

  // значение секрета не попадает в renderer
  const vars = await page.evaluate(() => window.api.variables.hints({ collectionId: null }))
  expect(vars.apiToken).toMatchObject({ value: '•••••', isSecret: true })
})

test('сценарий 4: история — запрос находится и повторяется в один клик', async ({ restless }) => {
  const { page } = restless
  await typeInto(page, page.getByTestId('url-input'), `${ECHO}/get?from=history`)
  await sendAndWait(page)

  await page.getByTestId('sidebar-history').click()
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
  const item = page.getByTestId('history-item').filter({ hasText: 'from=history' }).first()
  await expect(item).toBeVisible()

  await page.getByTestId('history-replay').first().click()
  await expect(page.getByTestId('request-tab')).toHaveCount(2)
  await expect(page.getByTestId('response-status')).toHaveText(/200/)
  await expect(page.getByTestId('url-input')).toHaveText(`${ECHO}/get?from=history`)

  // поиск по истории
  await page.getByRole('searchbox', { name: 'Поиск в истории' }).fill('from=history')
  await expect(page.getByTestId('history-item').first()).toBeVisible()
  await page.getByRole('searchbox', { name: 'Поиск в истории' }).fill('zzz-nothing')
  await expect(page.getByTestId('history-item')).toHaveCount(0)
})

test('сценарий 5: вставка cURL превращается в запрос; запрос копируется как cURL', async ({ restless }) => {
  const { page, app } = restless
  const curl = `curl -X PUT '${ECHO}/put?v=2' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Token: abc' \\
  --data-raw '{"name":"from curl"}'`
  await writeClipboard(app, curl)
  await page.getByTestId('url-input').click()
  await page.keyboard.press('ControlOrMeta+v')

  await expect(page.getByTestId('method-select')).toHaveValue('PUT')
  await expect(page.getByTestId('url-input')).toHaveText(`${ECHO}/put?v=2`)
  await page.getByRole('tab', { name: /^Заголовки/ }).click()
  await expect(page.getByRole('textbox', { name: 'Значение, строка 2' })).toHaveText('abc')

  await sendAndWait(page)
  const body = JSON.parse(await responseText(restless))
  expect(body.json).toEqual({ name: 'from curl' })
  expect(body.headers['X-Token']).toEqual(['abc'])

  await writeClipboard(app, '')
  await page.getByTestId('copy-curl').click()
  await expect.poll(() => readClipboard(app)).toContain('curl')
  const copied = await readClipboard(app)
  expect(copied).toContain(`${ECHO}/put?v=2`)
  expect(copied).toContain('-X PUT')
  expect(copied).toContain(`-H 'X-Token: abc'`)
  expect(copied).toContain(`--data-raw '{"name":"from curl"}'`)
})
