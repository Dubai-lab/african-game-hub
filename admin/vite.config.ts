import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The admin app is its own application: its own build, its own address, none of its code in the
// player app. Locally it reads the two public Supabase values from the project's .env.local
// (one folder up); when hosted they are set as environment variables on the admin deployment.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '..',
  // See the player app's vite.config.ts: stops an unrelated PostCSS config being picked up.
  css: { postcss: {} },
  // An office tool on a desk, not a download for a budget phone: one file is fine.
  build: { chunkSizeWarningLimit: 800 },
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
})
