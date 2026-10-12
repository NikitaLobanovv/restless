import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { generate } from 'selfsigned'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyDraft, type HttpResponseData, type HttpResult, type RequestDraft } from '../../src/shared/model'
import { cancelHttp, responses, sendHttp } from '../../src/main/http/client'

/**
 * Интеграционные тесты HTTP-клиента против echo-api (go-httpbin из docker-compose)
 * и локального HTTPS-сервера с самоподписанным сертификатом.
 */
const ECHO = process.env.ECHO_URL ?? `http://127.0.0.1:${process.env.ECHO_PORT ?? '8080'}`

const allowAll = (): void => undefined

function draft(patch: Partial<RequestDraft> & { url: string }): RequestDraft {
  return { ...emptyDraft(), ...patch }
}

function ok(r: HttpResult): HttpResponseData {
  if ('error' in r) throw new Error(`expected response, got ${r.code}: ${r.message}`)
  return r
}

function send(d: RequestDraft, requestId: string = crypto.randomUUID()): Promise<HttpResult> {
  return sendHttp({ requestId, draft: d, fileGuard: allowAll, userAgent: 'Restless/test' })
}

let tls: HttpsServer
let tlsUrl = ''
// go-httpbin не умеет brotli и ограничивает размер ответа — эти случаи отдаёт локальный сервер
let local: HttpServer
let localUrl = ''

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, algorithm: 'sha256' })
  tls = createHttpsServer({ key: pems.private, cert: pems.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"secure":true}')
  })
  await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r))
  tlsUrl = `https://localhost:${(tls.address() as AddressInfo).port}/`

  const big = Buffer.alloc(6_000_000, 'a')
  local = createHttpServer((req, res) => {
    if (req.url === '/brotli') {
      const body = brotliCompressSync(Buffer.from(JSON.stringify({ brotli: true, pad: 'x'.repeat(500) })))
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' })
      res.end(body)
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(big)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => local.listen(0, '127.0.0.1', r))
  localUrl = `http://127.0.0.1:${(local.address() as AddressInfo).port}`
})

afterAll(() => {
  tls?.close()
  local?.close()
})

describe('HTTP-клиент', () => {
  it('GET: статус, заголовки, время, размер, Timeline', async () => {
    const r = ok(
      await send(
        draft({ url: `${ECHO}/get?x=1`, params: [{ id: 'p', key: 'x', value: '1', description: '', enabled: true }] })
      )
    )
    expect(r.status).toBe(200)
    expect(r.contentType).toContain('application/json')
    expect(JSON.parse(r.bodyText).args).toEqual({ x: ['1'] })
    expect(r.durationMs).toBeGreaterThan(0)
    expect(r.sizeBytes).toBeGreaterThan(0)
    expect(r.timeline.tcpMs).toBeGreaterThanOrEqual(0)
    expect(r.timeline.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(responses.get(r.responseId)?.body.length).toBeGreaterThan(0)
  })

  it('POST JSON: авто Content-Type и User-Agent', async () => {
    const r = ok(
      await send(
        draft({ method: 'POST', url: `${ECHO}/post`, body: { ...emptyDraft().body, type: 'json', raw: '{"a":1}' } })
      )
    )
    const echo = JSON.parse(r.bodyText)
    expect(echo.headers['Content-Type']).toEqual(['application/json'])
    expect(echo.headers['User-Agent']).toEqual(['Restless/test'])
    expect(echo.json).toEqual({ a: 1 })
  })

  it('пользовательский Content-Type переопределяет автоматический', async () => {
    const r = ok(
      await send(
        draft({
          method: 'POST',
          url: `${ECHO}/post`,
          headers: [
            { id: 'h', key: 'content-type', value: 'application/vnd.api+json', description: '', enabled: true }
          ],
          body: { ...emptyDraft().body, type: 'json', raw: '{}' }
        })
      )
    )
    expect(JSON.parse(r.bodyText).headers['Content-Type']).toEqual(['application/vnd.api+json'])
  })

  it('x-www-form-urlencoded', async () => {
    const r = ok(
      await send(
        draft({
          method: 'POST',
          url: `${ECHO}/post`,
          body: {
            ...emptyDraft().body,
            type: 'urlencoded',
            urlencoded: [{ id: 'u', key: 'name', value: 'a b&c', description: '', enabled: true }]
          }
        })
      )
    )
    expect(JSON.parse(r.bodyText).form).toEqual({ name: ['a b&c'] })
  })

  it('multipart/form-data с файлом', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'restless-'))
    const file = join(dir, 'hello.txt')
    writeFileSync(file, 'file-content')
    const r = ok(
      await send(
        draft({
          method: 'POST',
          url: `${ECHO}/post`,
          body: {
            ...emptyDraft().body,
            type: 'multipart',
            multipart: [
              { id: '1', key: 'field', value: 'value', description: '', enabled: true, kind: 'text', files: [] },
              { id: '2', key: 'upload', value: '', description: '', enabled: true, kind: 'file', files: [file] }
            ]
          }
        })
      )
    )
    const echo = JSON.parse(r.bodyText)
    expect(echo.form).toEqual({ field: ['value'] })
    expect(Object.keys(echo.files)).toEqual(['upload'])
    expect(echo.headers['Content-Type'][0]).toMatch(/^multipart\/form-data; boundary=/)
  })

  it('файл, не выбранный через диалог, не читается', async () => {
    const r = await sendHttp({
      requestId: 'guard',
      userAgent: 'x',
      fileGuard: () => {
        throw Object.assign(new Error('not allowed'), { name: 'FileNotAllowedError' })
      },
      draft: draft({
        method: 'POST',
        url: `${ECHO}/post`,
        body: { ...emptyDraft().body, type: 'binary', binaryPath: '/etc/passwd' }
      })
    })
    expect(r).toMatchObject({ error: true, code: 'FILE' })
  })

  it('binary-тело', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'restless-'))
    const file = join(dir, 'data.bin')
    writeFileSync(file, Buffer.from([1, 2, 3, 4]))
    const r = ok(
      await send(
        draft({ method: 'PUT', url: `${ECHO}/put`, body: { ...emptyDraft().body, type: 'binary', binaryPath: file } })
      )
    )
    const echo = JSON.parse(r.bodyText)
    expect(echo.headers['Content-Type']).toEqual(['application/octet-stream'])
    expect(echo.headers['Content-Length']).toEqual(['4'])
  })

  it('редиректы: следование и отключение', async () => {
    const follow = ok(await send(draft({ url: `${ECHO}/redirect/3` })))
    expect(follow.status).toBe(200)
    expect(follow.redirects).toHaveLength(3)
    expect(follow.url).toBe(`${ECHO}/get`)

    const noFollow = ok(
      await send(
        draft({ url: `${ECHO}/redirect/3`, settings: { timeoutMs: 30000, followRedirects: false, verifySsl: true } })
      )
    )
    expect(noFollow.status).toBe(302)
    expect(noFollow.redirects).toEqual([])
  })

  it('303 после POST превращается в GET без тела', async () => {
    const r = ok(
      await send(
        draft({
          method: 'POST',
          url: `${ECHO}/redirect-to?url=${encodeURIComponent('/anything')}&status_code=303`,
          body: { ...emptyDraft().body, type: 'json', raw: '{"a":1}' }
        })
      )
    )
    const echo = JSON.parse(r.bodyText)
    expect(echo.method).toBe('GET')
    expect(echo.data).toBe('')
  })

  it('таймаут', async () => {
    const r = await send(
      draft({ url: `${ECHO}/delay/3`, settings: { timeoutMs: 500, followRedirects: true, verifySsl: true } })
    )
    expect(r).toMatchObject({ error: true, code: 'TIMEOUT' })
    expect((r as { durationMs: number }).durationMs).toBeLessThan(2500)
  })

  it('отмена выполняющегося запроса', async () => {
    const pending = send(draft({ url: `${ECHO}/delay/5` }), 'cancel-me')
    setTimeout(() => cancelHttp('cancel-me'), 200)
    expect(await pending).toMatchObject({ error: true, code: 'CANCELLED' })
  })

  it('gzip/deflate/brotli распаковываются, размер — на проводе', async () => {
    for (const url of [`${ECHO}/gzip`, `${ECHO}/deflate`, `${localUrl}/brotli`]) {
      const r = ok(await send(draft({ url })))
      expect(JSON.parse(r.bodyText)).toBeTypeOf('object')
      expect(r.sizeBytes).toBeLessThan(Buffer.byteLength(r.bodyText))
    }
  })

  it('большой ответ > 5 МБ помечается isLarge', async () => {
    const r = ok(await send(draft({ url: `${localUrl}/big` })))
    expect(r.status).toBe(200)
    expect(r.sizeBytes).toBe(6_000_000)
    expect(r.isLarge).toBe(true)
  })

  it('изображение отдаётся как data:-URL для Preview', async () => {
    const r = ok(await send(draft({ url: `${ECHO}/image/png` })))
    expect(r.imageDataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('cookies из Set-Cookie', async () => {
    const r = ok(
      await send(
        draft({
          url: `${ECHO}/cookies/set?session=abc&theme=dark`,
          settings: { timeoutMs: 30000, followRedirects: false, verifySsl: true }
        })
      )
    )
    expect(r.cookies.map((c) => [c.name, c.value]).sort()).toEqual([
      ['session', 'abc'],
      ['theme', 'dark']
    ])
  })

  it('коды 4xx/5xx — это ответ, а не ошибка', async () => {
    expect(ok(await send(draft({ url: `${ECHO}/status/404` }))).status).toBe(404)
    expect(ok(await send(draft({ url: `${ECHO}/status/503` }))).status).toBe(503)
  })

  it('произвольный метод и HEAD', async () => {
    const r = ok(await send(draft({ method: 'PROPFIND', url: `${ECHO}/anything` })))
    expect(JSON.parse(r.bodyText).method).toBe('PROPFIND')
    const head = ok(await send(draft({ method: 'HEAD', url: `${ECHO}/get` })))
    expect(head.status).toBe(200)
    expect(head.bodyText).toBe('')
  })

  it('TLS: самоподписанный сертификат отклоняется, с verifySsl=false — проходит, есть фаза TLS', async () => {
    const strict = await send(draft({ url: tlsUrl }))
    expect(strict).toMatchObject({ error: true, code: 'TLS' })
    const relaxed = ok(
      await send(draft({ url: tlsUrl, settings: { timeoutMs: 30000, followRedirects: true, verifySsl: false } }))
    )
    expect(JSON.parse(relaxed.bodyText)).toEqual({ secure: true })
    expect(relaxed.timeline.tlsMs).toBeGreaterThan(0)
    expect(relaxed.timeline.dnsMs).toBeGreaterThanOrEqual(0)
  })

  it('сетевые ошибки и некорректный URL', async () => {
    expect(await send(draft({ url: 'http://127.0.0.1:1/' }))).toMatchObject({ error: true, code: 'NETWORK' })
    expect(await send(draft({ url: 'ftp://x/' }))).toMatchObject({ error: true, code: 'INVALID_URL' })
    expect(await send(draft({ url: 'http://exa mple.com' }))).toMatchObject({ error: true, code: 'INVALID_URL' })
  })

  it('URL без схемы считается http', async () => {
    const r = ok(await send(draft({ url: ECHO.replace(/^http:\/\//, '') + '/get' })))
    expect(r.status).toBe(200)
  })
})
