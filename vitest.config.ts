import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors electron.vite.config.ts's renderer alias, so a component
      // test can import with the same paths the app itself uses.
      '@': resolve('src/renderer/src'),
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    // Stays 'node' by default (all 28 existing suites are main/shared logic
    // with no DOM). A *.test.tsx file opts into jsdom itself via a
    // `// @vitest-environment jsdom` docblock at its own top, so this default
    // never has to change and main-process tests are unaffected.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
})
