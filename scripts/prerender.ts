// Runs after `vite build`. Renders the landing page to HTML and writes it into dist/index.html,
// so search engines and WhatsApp/Facebook link previews see real content and visitors see the
// page before any JavaScript has run.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

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
  const guard = '<script>if(location.pathname!=="/")document.getElementById("root").textContent=""</script>'
  writeFileSync(indexPath, shell.replace(marker, () => `<div id="root">${html}</div>${guard}`))
  console.log(`Prerendered / into dist/index.html (${(html.length / 1024).toFixed(1)} KB of HTML)`)
} finally {
  rmSync(ssrDir, { recursive: true, force: true })
}

// The rendered app may leave timers behind (caches, clients). The work is done: leave now
// instead of waiting for them, so a build can never hang.
process.exit(0)
