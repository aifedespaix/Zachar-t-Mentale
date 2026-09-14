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
    //
    // Worktrees are full second checkouts of this repo (see .gitignore and
    // .git/info/exclude). Collecting them runs every suite twice and trips
    // over the standalone runners inside their own copy of `tools/`.
    // `admin/` est un SECOND projet, avec son propre vitest.config.ts, son
    // propre package.json et son propre alias `@app` vers ce `src/`. Collecté
    // ici, il s'exécuterait avec la configuration de celui-ci — où `@app`
    // n'existe pas — et chaque suite tomberait à l'import. On le lance par
    // `bun run test:admin`.
    exclude: [...configDefaults.exclude, 'tools/**', '.claude/**', '.worktrees/**', 'admin/**'],
  },
})
