import { describe, expect, it } from 'vitest'
import { generateCurl, shellQuote } from '../../src/shared/curl/generate'
import { CurlParseError, looksLikeCurl, parseCurl, tokenize } from '../../src/shared/curl/parse'
import { emptyDraft } from '../../src/shared/model'

describe('tokenize', () => {
  it('понимает кавычки, экранирование и переносы строк', () => {
    expect(tokenize(`curl -H 'A: b c' "x \\"y\\"" z\\ w \\\n  --x $'a\\nb'`)).toEqual([
      'curl',
      '-H',
      'A: b c',
      'x "y"',
      'z w',
      '--x',
      'a\nb'
    ])
  })

  it('переносы строк Windows cmd (^) и PowerShell (`)', () => {
    expect(tokenize('curl ^\n  -X POST `\n  url')).toEqual(['curl', '-X', 'POST', 'url'])
  })

  it('ошибка на незакрытых кавычках', () => {
    expect(() => tokenize("curl 'abc")).toThrow(CurlParseError)
    expect(() => tokenize('curl "abc')).toThrow(CurlParseError)
    expect(() => tokenize("curl $'abc")).toThrow(CurlParseError)
  })
})

describe('parseCurl', () => {
  it('looksLikeCurl', () => {
    expect(looksLikeCurl('  curl https://x')).toBe(true)
    expect(looksLikeCurl('curl.exe https://x')).toBe(true)
    expect(looksLikeCurl('https://x')).toBe(false)
  })

  it('простой GET', () => {
    const d = parseCurl('curl https://api.example.com/users?page=2')
    expect(d.method).toBe('GET')
    expect(d.url).toBe('https://api.example.com/users?page=2')
    expect(d.params.map((p) => [p.key, p.value])).toEqual([['page', '2']])
    expect(d.name).toBe('GET api.example.com/users')
  })

  it('POST с JSON из документации', () => {
    const d = parseCurl(`curl -X POST https://api.x.io/items \\
      -H 'Content-Type: application/json' \\
      -H "Authorization: Bearer abc" \\
      -d '{"name":"test","n":1}'`)
    expect(d.method).toBe('POST')
    expect(d.headers.map((h) => [h.key, h.value])).toEqual([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer abc']
    ])
    expect(d.body.type).toBe('json')
    expect(d.body.raw).toBe('{"name":"test","n":1}')
  })

  it('метод по умолчанию POST при наличии данных; form-urlencoded', () => {
    const d = parseCurl('curl https://x.io/login --data "user=a&pass=b"')
    expect(d.method).toBe('POST')
    expect(d.body.type).toBe('urlencoded')
    expect(d.body.urlencoded.map((p) => [p.key, p.value])).toEqual([
      ['user', 'a'],
      ['pass', 'b']
    ])
  })

  it('--data-urlencode, -u, -k, -L, --max-time, -A, -e, -b', () => {
    const d = parseCurl(
      "curl -kL --max-time 5 -u 'admin:sécret' -A agent -e http://ref -b 'a=1' --data-urlencode 'q=a b' --data-urlencode raw https://x.io"
    )
    expect(d.settings).toEqual({ timeoutMs: 5000, followRedirects: true, verifySsl: false })
    expect(d.headers.find((h) => h.key === 'Authorization')?.value).toBe(
      `Basic ${Buffer.from('admin:sécret').toString('base64')}`
    )
    expect(d.headers.find((h) => h.key === 'User-Agent')?.value).toBe('agent')
    expect(d.headers.find((h) => h.key === 'Referer')?.value).toBe('http://ref')
    expect(d.headers.find((h) => h.key === 'Cookie')?.value).toBe('a=1')
    expect(d.body.type).toBe('urlencoded')
    expect(d.body.urlencoded.map((p) => [p.key, p.value])).toEqual([
      ['q', 'a b'],
      ['raw', '']
    ])
  })

  it('multipart с файлом', () => {
    const d = parseCurl("curl -F 'file=@/tmp/a.png;type=image/png' -F name=John --form-string 'x=@lit' https://x.io/up")
    expect(d.method).toBe('POST')
    expect(d.body.type).toBe('multipart')
    expect(d.body.multipart.map((f) => [f.key, f.kind, f.value, f.files])).toEqual([
      ['file', 'file', '', ['/tmp/a.png']],
      ['name', 'text', 'John', []],
      ['x', 'text', '@lit', []]
    ])
  })

  it('-G переносит данные в query', () => {
    const d = parseCurl("curl -G https://x.io/s?a=1 -d q=test --data-urlencode 'w=a b'")
    expect(d.method).toBe('GET')
    expect(d.url).toBe('https://x.io/s?a=1&q=test&w=a%20b')
    expect(d.body.type).toBe('none')
  })

  it('-I → HEAD, -XPUT слитно, --request=PATCH, --url', () => {
    expect(parseCurl('curl -I https://x').method).toBe('HEAD')
    expect(parseCurl('curl -XPUT https://x').method).toBe('PUT')
    expect(parseCurl('curl --request=patch --url https://x').method).toBe('PATCH')
  })

  it('--json добавляет заголовки', () => {
    const d = parseCurl(`curl --json '{"a":1}' https://x`)
    expect(d.body.type).toBe('json')
    expect(d.headers.map((h) => h.key)).toEqual(['Content-Type', 'Accept'])
  })

  it('XML и произвольный текст', () => {
    expect(parseCurl(`curl -H 'Content-Type: text/xml' -d '<a/>' https://x`).body.type).toBe('xml')
    expect(parseCurl(`curl -H 'Content-Type: text/plain' -d 'hello world' https://x`).body.type).toBe('text')
  })

  it('игнорирует неизвестные флаги со значениями и без', () => {
    const d = parseCurl('curl -sS -o out.txt -w "%{http_code}" --compressed --retry 3 https://x/y')
    expect(d.url).toBe('https://x/y')
  })

  it('ошибки', () => {
    expect(() => parseCurl('wget https://x')).toThrow(CurlParseError)
    expect(() => parseCurl('curl -X POST')).toThrow('URL not found')
    expect(() => parseCurl('curl -H')).toThrow(CurlParseError)
  })
})

describe('generateCurl', () => {
  it('shellQuote', () => {
    expect(shellQuote('abc')).toBe('abc')
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('')).toBe("''")
  })

  it('GET без лишних флагов', () => {
    const d = emptyDraft()
    d.url = 'https://x.io/a'
    d.settings.followRedirects = false
    expect(generateCurl(d)).toBe('curl https://x.io/a')
  })

  it('POST JSON с авто Content-Type и настройками', () => {
    const d = emptyDraft()
    d.method = 'POST'
    d.url = 'https://x.io/a'
    d.headers = [{ id: '1', key: 'X-Id', value: "o'k", description: '', enabled: true }]
    d.body = { ...d.body, type: 'json', raw: '{"a":1}' }
    d.settings = { timeoutMs: 5000, followRedirects: true, verifySsl: false }
    expect(generateCurl(d)).toBe(
      [
        'curl https://x.io/a',
        `-H 'X-Id: o'\\''k'`,
        `-H 'Content-Type: application/json'`,
        `--data-raw '{"a":1}'`,
        '-L',
        '-k',
        '--max-time 5'
      ].join(' \\\n  ')
    )
  })

  it('другие типы тела и методы', () => {
    const d = emptyDraft()
    d.method = 'PUT'
    d.url = 'https://x'
    d.settings.followRedirects = false
    d.body = {
      ...d.body,
      type: 'urlencoded',
      urlencoded: [{ id: '1', key: 'a', value: 'b c', description: '', enabled: true }]
    }
    expect(generateCurl(d)).toContain(`-X PUT`)
    expect(generateCurl(d)).toContain(`--data-urlencode 'a=b c'`)

    d.body = {
      ...d.body,
      type: 'multipart',
      multipart: [
        { id: '1', key: 'f', value: '', description: '', enabled: true, kind: 'file', files: ['/tmp/x.bin'] },
        { id: '2', key: 'n', value: 'v', description: '', enabled: true, kind: 'text', files: [] }
      ]
    }
    expect(generateCurl(d)).toContain(`-F f=@/tmp/x.bin`)
    expect(generateCurl(d)).toContain(`--form-string n=v`)

    d.body = { ...d.body, type: 'binary', binaryPath: '/tmp/x.bin' }
    expect(generateCurl(d)).toContain(`--data-binary @/tmp/x.bin`)

    d.method = 'HEAD'
    d.body = { ...d.body, type: 'none' }
    expect(generateCurl(d)).toBe('curl https://x \\\n  -I')
  })

  it('round-trip: parse(generate(d)) сохраняет суть запроса', () => {
    const d = emptyDraft()
    d.method = 'PATCH'
    d.url = 'https://api.x.io/items/1?expand=all'
    d.params = [{ id: 'p', key: 'expand', value: 'all', description: '', enabled: true }]
    d.headers = [{ id: 'h', key: 'Authorization', value: 'Bearer t', description: '', enabled: true }]
    d.body = { ...d.body, type: 'json', raw: '{"name":"it\'s"}' }
    const back = parseCurl(generateCurl(d))
    expect(back.method).toBe('PATCH')
    expect(back.url).toBe(d.url)
    expect(back.body).toMatchObject({ type: 'json', raw: d.body.raw })
    expect(back.headers.find((h) => h.key === 'Authorization')?.value).toBe('Bearer t')
    expect(back.settings.followRedirects).toBe(true)
  })
})
