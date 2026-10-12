import { describe, expect, it } from 'vitest'
import type { KeyValue } from '../../src/shared/model'
import {
  buildQuery,
  encodeParam,
  newId,
  paramsFromUrl,
  parseQuery,
  splitUrl,
  urlWithParams
} from '../../src/shared/url-params'

const kv = (key: string, value: string, enabled = true, description = ''): KeyValue => ({
  id: newId(),
  key,
  value,
  description,
  enabled
})

describe('splitUrl / parseQuery', () => {
  it('разбирает базу, query и hash', () => {
    expect(splitUrl('http://a/b?x=1&y#top')).toEqual({ base: 'http://a/b', query: 'x=1&y', hash: '#top' })
    expect(splitUrl('http://a/b')).toEqual({ base: 'http://a/b', query: null, hash: '' })
  })

  it('декодирует значения и терпит битые последовательности', () => {
    expect(parseQuery('a=1&b=hello%20world&c&d=%E0%A4%A&e=x+y')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: 'hello world' },
      { key: 'c', value: '' },
      { key: 'd', value: '%E0%A4%A' },
      { key: 'e', value: 'x y' }
    ])
    expect(parseQuery('')).toEqual([])
  })
})

describe('encodeParam / buildQuery', () => {
  it('не кодирует шаблоны переменных', () => {
    expect(encodeParam('a b{{var name}}&')).toBe('a%20b{{var name}}%26')
  })

  it('пропускает выключенные и пустые строки', () => {
    expect(buildQuery([kv('a', '1'), kv('b', '2', false), kv('', ''), kv('flag', '')])).toBe('a=1&flag')
  })
})

describe('двусторонняя синхронизация URL ↔ таблица', () => {
  it('URL → таблица сохраняет id, описания и выключенные строки', () => {
    const current = [kv('a', 'old', true, 'desc A'), kv('off', 'z', false)]
    const next = paramsFromUrl('http://h/p?a=1&b={{v}}', current)
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['a', '1', true],
      ['b', '{{v}}', true],
      ['off', 'z', false]
    ])
    expect(next[0].id).toBe(current[0].id)
    expect(next[0].description).toBe('desc A')
  })

  it('URL без query очищает включённые параметры', () => {
    expect(paramsFromUrl('http://h', [kv('a', '1')])).toEqual([])
  })

  it('таблица → URL сохраняет hash', () => {
    expect(urlWithParams('http://h/p?old=1#frag', [kv('q', 'a b'), kv('x', '1', false)])).toBe(
      'http://h/p?q=a%20b#frag'
    )
    expect(urlWithParams('http://h/p?old=1', [])).toBe('http://h/p')
  })

  it('сохраняет шаблоны переменных в query', () => {
    expect(urlWithParams('{{base}}/u?ignored=1', [kv('id', '{{id}}')])).toBe('{{base}}/u?id={{id}}')
  })

  it('newId выдаёт уникальные значения', () => {
    expect(newId()).not.toBe(newId())
  })
})
