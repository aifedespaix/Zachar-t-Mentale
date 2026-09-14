import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error type error without @types/node package
import path from 'node:path'
// @ts-expect-error type error without @types/node package
import process from 'node:process'

/**
 * L'interface d'administration, servie par PocketBase lui-même.
 *
 * `base: './'` n'est pas cosmétique : le SPA est déposé dans `/pb_public`, donc
 * à la RACINE du même domaine que l'API, et des chemins absolus marcheraient —
 * mais des chemins relatifs marchent aussi derrière un sous-chemin, ce qui
 * laisse le choix ouvert sans rien coûter aujourd'hui.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @ts-expect-error type error without @types/node package
      '@': path.resolve(import.meta.dirname, './src'),
      // Le code PUR de l'application de bureau — types des cartes, validation
      // structurelle, sérialisation. Il est importé, jamais recopié : un
      // validateur qui diverge du format réel est pire que pas de validateur.
      // Tout ce qui touche à Tauri reste hors de portée de cet alias par
      // construction, puisque rien ici ne l'importe.
      // @ts-expect-error type error without @types/node package
      '@app': path.resolve(import.meta.dirname, '../src'),
    },
  },
  server: {
    port: 1430,
    // En développement, l'API est celle d'un vrai PocketBase : on la proxifie
    // pour reproduire exactement la topologie de production (même origine),
    // donc zéro CORS ici comme là-bas.
    proxy: {
      '/api': { target: process.env.PB_URL || 'http://127.0.0.1:8090', changeOrigin: true },
      '/_': { target: process.env.PB_URL || 'http://127.0.0.1:8090', changeOrigin: true },
    },
  },
})
