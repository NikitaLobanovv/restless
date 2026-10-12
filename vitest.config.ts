import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/shared/variables.ts',
        'src/shared/url-params.ts',
        'src/shared/curl/**',
        'src/shared/http-utils.ts',
        'src/main/db/repos/**'
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 }
    }
  }
})
