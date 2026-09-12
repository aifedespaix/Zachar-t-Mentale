import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
// @ts-expect-error type error without @types/node package
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @ts-expect-error type error without @types/node package
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // `tools/` holds standalone scripts with their own node runners
    // (e.g. `node test/rewrite.test.mjs`). Vitest would collect them as
    // suites and fail on files that contain no `describe`/`it`.
    exclude: [...configDefaults.exclude, 'tools/**'],
  },
})
