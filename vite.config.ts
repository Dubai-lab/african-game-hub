import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Emits app.html: a copy of index.html as it is before the landing page is rendered into it.
 * index.html is served for "/" (the prerendered landing page); app.html is the empty shell for
 * every other route, so the lobby or login page never downloads the landing page's markup or
 * picture. The host and the service worker both send app routes to app.html.
 */
function appShell(): Plugin {
  return {
    name: 'agh-app-shell',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (index?.type !== 'asset') return
      // Something to look at the instant the file arrives, while the app itself downloads.
      // React replaces it on its first render.
      const splash =
        '<div id="root"><div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;' +
        'background:#eef0fa;color:#1f2a7a;font:800 1.4rem system-ui,sans-serif">African Game Hub</div></div>'
      const source = String(index.source).replace('<div id="root"></div>', splash)
      this.emitFile({ type: 'asset', fileName: 'app.html', source })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    appShell(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'African Game Hub',
        short_name: 'Game Hub',
        description: 'Play skill games against real opponents across Africa.',
        start_url: '/lobby',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#eef0fa',
        theme_color: '#1f2a7a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App shell only. Supabase responses (balances, games) are never cached by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never precache the landing page's 3D scene or pictures (app users must not pay for them),
        // nor the font files for scripts we do not use.
        globIgnores: ['**/HeroScene-*.js', 'landing/**', 'engine/**', '**/*-{math,symbols,vietnamese}-*.woff2'],
        // App routes open the empty shell; '/' itself is the prerendered landing page.
        navigateFallback: '/app.html',
        navigateFallbackDenylist: [/^\/$/],
        // The chess engine is downloaded the first time someone plays the computer, then kept
        // on the phone so later games (and offline practice) cost no data.
        runtimeCaching: [
          // Sounds are fetched the first time they are needed, then kept on the phone.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/sounds/'),
            handler: 'CacheFirst',
            options: { cacheName: 'sounds', expiration: { maxEntries: 40 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/engine/'),
            handler: 'CacheFirst',
            options: { cacheName: 'chess-engine', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
  // Inline (empty) PostCSS config stops Vite from searching parent folders and loading an
  // unrelated postcss.config.js from the home directory. Tailwind runs through its Vite plugin.
  css: { postcss: {} },
  // Pre-bundle the lazily loaded game libraries, so the dev server does not reload the page the
  // first time a game screen is opened.
  optimizeDeps: { include: ['chess.js', 'react-chessboard'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
