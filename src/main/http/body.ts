import { openAsBlob } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { FormData } from 'undici'
import { autoContentType } from '../../shared/http-utils'
import type { RequestBody } from '../../shared/model'

export interface BuiltBody {
  body: string | Buffer | FormData | null
  contentType: string | null
}

export type FileGuard = (path: string) => void

export async function buildBody(body: RequestBody, guard: FileGuard): Promise<BuiltBody> {
  const contentType = autoContentType(body.type)
  switch (body.type) {
    case 'none':
      return { body: null, contentType: null }
    case 'json':
    case 'text':
    case 'xml':
      return { body: body.raw, contentType }
    case 'urlencoded': {
      const enabled = body.urlencoded.filter((p) => p.enabled && p.key !== '')
      const encoded = enabled
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
        .replace(/%20/g, '+')
      return { body: encoded, contentType }
    }
    case 'multipart': {
      const fd = new FormData()
      for (const f of body.multipart) {
        if (!f.enabled || f.key === '') continue
        if (f.kind === 'file') {
          for (const path of f.files) {
            guard(path)
            const blob = await openAsBlob(path)
            fd.append(f.key, blob, basename(path))
          }
        } else {
          fd.append(f.key, f.value)
        }
      }
      return { body: fd, contentType: null }
    }
    case 'binary': {
      if (!body.binaryPath) return { body: null, contentType: null }
      guard(body.binaryPath)
      return { body: await readFile(body.binaryPath), contentType }
    }
    default:
      return { body: null, contentType: null }
  }
}
