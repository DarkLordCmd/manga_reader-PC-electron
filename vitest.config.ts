import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      electron: resolve('tests/electron-mock.ts')
    }
  },
  define: { __GOOGLE_CLIENT_SECRET__: "''" },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})