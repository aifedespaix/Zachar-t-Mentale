import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
// @ts-expect-error type error without @types/node package
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @ts-expect-error type error without @types/node package
      '@': path.resolve(import.meta.dirname, './src'),
      // @ts-expect-error type error without @types/node package
      '@app': path.resolve(import.meta.dirname, '../src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
