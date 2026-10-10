// Runs after `vite build`. Renders the landing page to HTML and writes it into dist/index.html,
// so search engines and WhatsApp/Facebook link previews see real content and visitors see the
// page before any JavaScript has run.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, loadEnv } from 'vite'

// The pages anyone may read, as the app itself lists them.
const PUBLIC_PAGES: Record<string, unknown> = {
  '/': 1,
  '/signup': 1,
  '/login': 1,
  '/terms': 1,
  '/privacy': 1,
  '/cookies': 1,
  '/refunds': 1,
  '/responsible-gaming': 1,
}

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
  // The sign-up check (Cloudflare Turnstile), when this build has one: its script, and the
  // frame it draws itself in. Nothing of Cloudflare's is allowed otherwise.
  const turnstile = loadEnv('production', root, 'VITE_').VITE_TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : ''
  const policy = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets the chess engine (WebAssembly) start; it does not allow eval().
    `script-src 'self' 'sha256-${guardHash}' 'wasm-unsafe-eval'${turnstile}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    // Players' profile photos are served from the project's storage.
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${gameServer}`,
    "manifest-src 'self'",
    ...(turnstile ? [`frame-src${turnstile}`] : []),
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

  // For search engines: which pages there are (sitemap.xml) and where not to look (robots.txt).
  // Only a build for the hub's real address invites them in. A build for a developer's computer
  // or a test address tells them to stay away, so a copy of the site can never be listed.
  const siteUrl = (loadEnv('production', root, 'VITE_').VITE_SITE_URL ?? '').replace(/\/+$/, '')
  const published = /^https:\/\//.test(siteUrl) && !/localhost|127\.0\.0\.1|\.cloudfront\.net|\.vercel\.app/.test(siteUrl)
  if (published) {
    // The day a page's words last changed is the day its source last changed.
    const day = (...files: string[]) =>
      new Date(Math.max(...files.filter((file) => existsSync(join(root, file))).map((file) => statSync(join(root, file)).mtimeMs), 0) || Date.now())
        .toISOString()
        .slice(0, 10)
    const words = 'src/core/i18n/locales/en.json'
    const pages = Object.keys(PUBLIC_PAGES).map((path) => ({
      path,
      changed: day(words, path === '/' ? 'index.html' : words),
      weight: path === '/' ? '1.0' : path === '/signup' ? '0.8' : path === '/login' ? '0.5' : '0.3',
    }))
    const sitemap =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      pages.map((page) => `  <url><loc>${siteUrl}${page.path}</loc><lastmod>${page.changed}</lastmod><priority>${page.weight}</priority></url>\n`).join('') +
      '</urlset>\n'
    writeFileSync(join(root, 'dist', 'sitemap.xml'), sitemap)
    // Behind the log-in there is nothing to read; the addresses are listed so no time is spent on them.
    const closed = ['/lobby', '/play/', '/wallet', '/leaderboards', '/friends', '/profile', '/players/', '/settings', '/tournaments/', '/challenge/', '/auth/', '/forgot-password']
    writeFileSync(
      join(root, 'dist', 'robots.txt'),
      `User-agent: *\nAllow: /\n${closed.map((path) => `Disallow: ${path}\n`).join('')}\nSitemap: ${siteUrl}/sitemap.xml\n`,
    )
    console.log(`Wrote sitemap.xml (${pages.length} pages) and robots.txt for ${siteUrl}`)
  } else {
    rmSync(join(root, 'dist', 'sitemap.xml'), { force: true })
    writeFileSync(join(root, 'dist', 'robots.txt'), 'User-agent: *\nDisallow: /\n')
    console.log(`Not the hub's public address (${siteUrl || 'none set'}): robots.txt tells search engines to stay away`)
  }
} finally {
  rmSync(ssrDir, { recursive: true, force: true })
}

// The rendered app may leave timers behind (caches, clients). The work is done: leave now
// instead of waiting for them, so a build can never hang.
process.exit(0)
