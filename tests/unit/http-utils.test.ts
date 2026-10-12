import { describe, expect, it } from 'vitest'
import {
  autoContentType,
  bodyLanguage,
  formatBytes,
  formatDuration,
  formatJson,
  formatXml,
  hasHeader,
  isTextualContentType,
  parseSetCookie,
  statusClass,
  validateJson
} from '../../src/shared/http-utils'

describe('http-utils', () => {
  it('autoContentType по типу тела', () => {
    expect(autoContentType('json')).toBe('application/json')
    expect(autoContentType('xml')).toBe('application/xml')
    expect(autoContentType('text')).toBe('text/plain')
    expect(autoContentType('urlencoded')).toBe('application/x-www-form-urlencoded')
    expect(autoContentType('binary')).toBe('application/octet-stream')
    expect(autoContentType('multipart')).toBeNull()
    expect(autoContentType('none')).toBeNull()
  })

  it('hasHeader без учёта регистра и только включённые', () => {
    const h = [
      { id: '1', key: ' content-type ', value: 'x', description: '', enabled: true },
      { id: '2', key: 'Accept', value: 'x', description: '', enabled: false }
    ]
    expect(hasHeader(h, 'Content-Type')).toBe(true)
    expect(hasHeader(h, 'accept')).toBe(false)
  })

  it('statusClass', () => {
    expect([101, 200, 302, 404, 503].map(statusClass)).toEqual(['info', 'success', 'redirect', 'client', 'server'])
  })

  it('formatBytes / formatDuration', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.00 KB')
    expect(formatBytes(20 * 1024)).toBe('20.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
    expect(formatDuration(12.4)).toBe('12 ms')
    expect(formatDuration(1530)).toBe('1.53 s')
  })

  it('parseSetCookie', () => {
    expect(
      parseSetCookie('sid=abc; Path=/; Domain=x.io; HttpOnly; Secure; SameSite=Lax; Max-Age=60; Expires=Wed')
    ).toEqual({
      name: 'sid',
      value: 'abc',
      path: '/',
      domain: 'x.io',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: '60',
      expires: 'Wed'
    })
    expect(parseSetCookie('broken')).toBeNull()
    expect(parseSetCookie('')).toBeNull()
  })

  it('isTextualContentType', () => {
    expect(isTextualContentType('application/json; charset=utf-8')).toBe(true)
    expect(isTextualContentType('text/html')).toBe(true)
    expect(isTextualContentType('application/problem+xml')).toBe(true)
    expect(isTextualContentType('image/png')).toBe(false)
    expect(isTextualContentType('application/octet-stream')).toBe(false)
  })

  it('bodyLanguage по Content-Type и содержимому', () => {
    expect(bodyLanguage('application/json', '')).toBe('json')
    expect(bodyLanguage('text/html', '')).toBe('html')
    expect(bodyLanguage('application/xml', '')).toBe('xml')
    expect(bodyLanguage('', '{"a":1}')).toBe('json')
    expect(bodyLanguage('', '{broken')).toBe('text')
    expect(bodyLanguage('', '<!DOCTYPE html><p>')).toBe('html')
    expect(bodyLanguage('', '<a/>')).toBe('xml')
    expect(bodyLanguage('text/plain', 'hi')).toBe('text')
  })

  it('formatJson / validateJson', () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(validateJson('')).toBeNull()
    expect(validateJson('{"a":1}')).toBeNull()
    expect(validateJson('{a:1}')).toBeTypeOf('string')
  })

  it('formatXml расставляет отступы', () => {
    expect(formatXml('<?xml version="1.0"?><a><b>text</b><c/></a>')).toBe(
      '<?xml version="1.0"?>\n<a>\n  <b>text</b>\n  <c/>\n</a>'
    )
  })
})
