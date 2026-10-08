// Runs SQL on the hosted database through the Supabase Management API.
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in .env.local. Never used by the app itself.

process.loadEnvFile('.env.local')

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing from .env.local`)
  return value
}

/**
 * Stops scripts that create test accounts or play test games from ever running against a real,
 * live project. Such scripts only run when .env.local says AGH_ENVIRONMENT=development.
 */
export function requireDevelopmentProject(what: string) {
  if (process.env.AGH_ENVIRONMENT !== 'development') {
    throw new Error(
      `Refusing to ${what}: this is only allowed on a development project. ` +
        'Set AGH_ENVIRONMENT=development in .env.local if (and only if) this project holds no real players.',
    )
  }
}

const API = 'https://api.supabase.com/v1/projects'

export async function managementFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}/${requireEnv('SUPABASE_PROJECT_REF')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs SQL as the database owner and returns the rows of the last statement.
 * The Management API allows only so many requests a minute; when it says "too many" the request
 * is simply sent again after a pause.
 */
export async function runSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await managementFetch('/database/query', { method: 'POST', body: JSON.stringify({ query }) })
    const text = await res.text()
    if (res.ok) return text ? (JSON.parse(text) as T[]) : []

    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch {
      // Not JSON; show the raw body.
    }
    const throttled = res.status === 429 || /ThrottlerException|Too Many Requests/i.test(message)
    if (!throttled || attempt >= 12) throw new Error(message.trim())
    await sleep(2000 + attempt * 1500 + Math.random() * 1000)
  }
}
