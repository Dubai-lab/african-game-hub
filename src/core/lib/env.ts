import * as z from 'zod/mini'

// zod/mini throughout the app: the same validation as full Zod at a fraction of the download.
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().check(z.minLength(20)),
  // Shown in the landing page footer. Optional: the line is left out when unset.
  VITE_CONTACT_EMAIL: z.optional(z.email()),
})

const parsed = envSchema.safeParse(import.meta.env)

/** Null when .env.local is missing or wrong; the app then shows a setup screen instead of crashing. */
export const env = parsed.success ? parsed.data : null
