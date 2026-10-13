import { safeStorage } from 'electron'

const PREFIX = 'enc:v1:'

export interface SecretCodec {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX)
}

export const safeStorageCodec: SecretCodec = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is not available, secret cannot be stored')
    }
    return PREFIX + safeStorage.encryptString(plain).toString('base64')
  },
  decrypt(stored) {
    if (!isEncrypted(stored)) return stored
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'))
  }
}

export function isWeakSecretStorage(): boolean {
  if (process.platform !== 'linux') return false
  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text'
  } catch {
    return false
  }
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) {
    if (s.length < 3) continue
    out = out.split(s).join('•••••')
  }
  return out
}
