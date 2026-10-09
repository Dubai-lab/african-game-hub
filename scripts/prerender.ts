// Runs after `vite build`. Renders the landing page to HTML and writes it into dist/index.html,
// so search engines and WhatsApp/Facebook link previews see real content and visitors see the
// page before any JavaScript has run.
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, loadEnv } from 'vite'

const root = process.cwd()
const ssrDir = join(root, 'dist-ssr')
const indexPath = join(root, 'dist', 'index.html')

await build({
  logLevel: 'warn',
  // The service worker belongs to the client build only.
  plugins: [],
  build: { ssr: 'src/entry-server.tsx', outDir: ssrDir, emptyOutDir: true },
})

try {
  const { render } = (await import(pathToFileURL(join(ssrDir, 'entry-server.js')).href)) as {
    render: (location: string) => Promise<string>
  }
  const html = await render('/')
  if (!html.includes('<h1')) throw new Error('Prerender produced no landing page content')

  const shell = readFileSync(indexPath, 'utf8')
  const marker = '<div id="root"></div>'
  if (!shell.includes(marker)) throw new Error(`dist/index.html has no ${marker}`)

  // index.html is also what the host and the service worker serve for every other route
  // (/lobby, /login, ...). There the landing markup must not flash, so it is removed before paint.
  const guardCode = 'if(location.pathname!=="/")document.getElementById("root").textContent=""'
  const guard = `<script>${guardCode}</script>`

  // A content security policy, written into both entry pages so it applies on any host. The
  // browser will run scripts only from this site (plus the one small script above, named by its
  // fingerprint), and will talk only to this site and Supabase. Injected text that somehow
  // reached a page could therefore neither run nor send anything anywhere.
  const guardHash = createHash('sha256').update(guardCode).digest('base64')
  // The game server, when this build has one. (On the site's own address 'self' already covers
  // it, but some older browsers do not count a wss: address as 'self', so it is named.)
  const gameServerUrl = loadEnv('production', root, 'VITE_').VITE_GAME_SERVER_URL
  const gameServer = gameServerUrl ? ` ${new URL(gameServerUrl).origin}` : ''
  const policy = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets the chess engine (WebAssembly) start; it does not allow eval().
    `script-src 'self' 'sha256-${guardHash}' 'wasm-unsafe-eval'`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${gameServer}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
  const withPolicy = (page: string) => {
    if (!page.includes('<meta charset="UTF-8" />')) throw new Error('entry page has no charset tag to put the security policy after')
    return page.replace('<meta charset="UTF-8" />', () => `<meta charset="UTF-8" />\n    ${meta}`)
  }
  const appPath = join(root, 'dist', 'app.html')
  writeFileSync(appPath, withPolicy(readFileSync(appPath, 'utf8')))
  writeFileSync(indexPath, withPolicy(shell.replace(marker, () => `<div id="root">${html}</div>${guard}`)))
  console.log(`Prerendered / into dist/index.html (${(html.length / 1024).toFixed(1)} KB of HTML)`)
} finally {
  rmSync(ssrDir, { recursive: true, force: true })
}

// The rendered app may leave timers behind (caches, clients). The work is done: leave now
// instead of waiting for them, so a build can never hang.
process.exit(0)
