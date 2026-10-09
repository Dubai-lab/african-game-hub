// Runs one of the npm scripts against the DEVELOPMENT project instead of the live one.
// Usage: npm run on-dev -- db:push
//        npm run on-dev -- e2e -- e2e/online.spec.ts
// The development project's details are in .env.dev.local (never committed). Every script that
// reads .env.local reads that file instead when AGH_ENV_FILE says so.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const file = '.env.dev.local'
if (!existsSync(file)) throw new Error(`${file} is missing: it holds the development project's keys`)
const [script, ...rest] = process.argv.slice(2)
if (!script) throw new Error('Say which npm script to run, for example: npm run on-dev -- db:push')
const result = spawnSync('npm', ['run', script, ...rest], { stdio: 'inherit', shell: true, env: { ...process.env, AGH_ENV_FILE: file } })
process.exit(result.status ?? 1)
