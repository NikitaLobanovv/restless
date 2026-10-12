import { describe, expect, it } from 'vitest'
import { emptyDraft } from '../../src/shared/model'
import {
  findVariables,
  mergeLayers,
  referencedVariables,
  resolveDraft,
  resolveTemplate
} from '../../src/shared/variables'

describe('resolveTemplate', () => {
  it('подставляет переменные и сообщает о неразрешённых', () => {
    const r = resolveTemplate('{{baseUrl}}/users/{{ id }}?q={{missing}}', { baseUrl: 'https://api', id: '7' })
    expect(r.value).toBe('https://api/users/7?q={{missing}}')
    expect(r.unresolved).toEqual(['missing'])
  })

  it('раскрывает вложенные переменные', () => {
    const r = resolveTemplate('{{url}}', { url: '{{host}}/v1', host: 'http://x' })
    expect(r.value).toBe('http://x/v1')
  })

  it('не зацикливается на циклических ссылках', () => {
    const r = resolveTemplate('{{a}}', { a: '{{b}}', b: '{{a}}' })
    expect(r.value).toBe('{{a}}')
    expect(r.unresolved).toContain('a')
  })

  it('пустое значение — это тоже значение', () => {
    expect(resolveTemplate('x{{e}}y', { e: '' })).toEqual({ value: 'xy', unresolved: [] })
  })

  it('не трогает одиночные скобки и пустые {{}}', () => {
    expect(resolveTemplate('{a} {{}} {{ }}', {}).value).toBe('{a} {{}} {{ }}')
  })

  it('не использует свойства прототипа', () => {
    expect(resolveTemplate('{{toString}}', {}).unresolved).toEqual(['toString'])
  })
})

describe('mergeLayers', () => {
  it('приоритет: окружение → коллекция → глобальные', () => {
    const merged = mergeLayers([{ a: 'env' }, { a: 'col', b: 'col' }, { a: 'g', b: 'g', c: 'g' }])
    expect(merged).toEqual({ a: 'env', b: 'col', c: 'g' })
  })
})

describe('findVariables / referencedVariables', () => {
  it('находит уникальные имена', () => {
    expect(findVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('учитывает только включённые строки и текстовые тела', () => {
    const d = emptyDraft()
    d.url = '{{base}}/x'
    d.headers = [
      { id: '1', key: 'Authorization', value: 'Bearer {{token}}', description: '', enabled: true },
      { id: '2', key: 'X-Off', value: '{{off}}', description: '', enabled: false }
    ]
    d.body = { ...d.body, type: 'json', raw: '{"a":"{{bodyVar}}"}' }
    expect(referencedVariables(d).sort()).toEqual(['base', 'bodyVar', 'token'])
  })
})

describe('resolveDraft', () => {
  it('подставляет в URL, параметры, заголовки и тело', () => {
    const d = emptyDraft()
    d.url = '{{base}}/items'
    d.params = [{ id: 'p', key: 'q', value: '{{q}}', description: '', enabled: true }]
    d.headers = [{ id: 'h', key: 'X-{{h}}', value: '{{v}}', description: '', enabled: true }]
    d.body = {
      ...d.body,
      type: 'multipart',
      raw: '{{notUsed}}',
      urlencoded: [{ id: 'u', key: 'k', value: '{{v}}', description: '', enabled: true }],
      multipart: [
        { id: 'm', key: '{{h}}', value: '{{v}}', description: '', enabled: true, kind: 'text', files: [] },
        { id: 'f', key: 'file', value: '{{v}}', description: '', enabled: true, kind: 'file', files: ['/a'] },
        { id: 'x', key: '{{off}}', value: '', description: '', enabled: false, kind: 'text', files: [] }
      ]
    }
    const { draft, unresolved } = resolveDraft(d, { base: 'http://h', q: 'search', h: 'Head', v: 'val' })
    expect(draft.url).toBe('http://h/items')
    expect(draft.params[0].value).toBe('search')
    expect(draft.headers[0]).toMatchObject({ key: 'X-Head', value: 'val' })
    expect(draft.body.raw).toBe('{{notUsed}}')
    expect(draft.body.urlencoded[0].value).toBe('val')
    expect(draft.body.multipart[0]).toMatchObject({ key: 'Head', value: 'val' })
    expect(draft.body.multipart[1].value).toBe('{{v}}')
    expect(draft.body.multipart[2].key).toBe('{{off}}')
    expect(unresolved).toEqual([])
  })

  it('подставляет в raw-тело JSON', () => {
    const d = emptyDraft()
    d.body = { ...d.body, type: 'json', raw: '{"t":"{{t}}","m":"{{m}}"}' }
    const r = resolveDraft(d, { t: '1' })
    expect(r.draft.body.raw).toBe('{"t":"1","m":"{{m}}"}')
    expect(r.unresolved).toEqual(['m'])
  })
})
