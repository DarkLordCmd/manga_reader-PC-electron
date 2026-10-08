import { safeStorage } from 'electron'

const PREFIX = 'enc:v1:'

export function isEncrypted(v: string): boolean {
  return v.startsWith(PREFIX)
}

/** Возвращает зашифрованный текст с префиксом; '' остаётся ''; null — шифрование недоступно/ошибка. */
export function encryptSecret(plain: string): string | null {
  if (plain === '') return plain
  if (!safeStorage.isEncryptionAvailable()) return null
  try { return PREFIX + safeStorage.encryptString(plain).toString('base64') } catch { return null }
}

/** Расшифровывает; legacy-плейнтекст возвращает как есть; битый шифртекст → ''. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
    return safeStorage.decryptString(raw)
  } catch {
    console.warn('[secret-box] не удалось расшифровать секрет — сброс значения')
    return ''
  }
}
