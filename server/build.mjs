// Builds the game server into one file, dist/server.cjs, with everything it needs inside it,
// so the machine that runs it needs only Node.
//
// The rules of each game live in supabase/functions/_shared, shared with the Edge Functions.
// Those files name their libraries the Deno way ("npm:chess.js@1.4.0"); here that is read as
// the same library installed for Node.
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(here, 'dist', 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'inline',
  logLevel: 'info',
  plugins: [
    {
      name: 'deno-npm-specifiers',
      setup(api) {
        api.onResolve({ filter: /^npm:/ }, (args) => api.resolve(args.path.replace(/^npm:/, '').replace(/(?<=.)@[\d.^~]+$/, ''), { kind: args.kind, resolveDir: here }))
      },
    },
  ],
})
