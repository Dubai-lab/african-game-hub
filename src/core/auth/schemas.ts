import * as z from 'zod/mini'

// Messages are i18n keys, translated where the error is shown.
const email = z.pipe(z.string().check(z.trim(), z.toLowerCase()), z.email('validation.emailInvalid'))

export const loginSchema = z.object({
  email,
  password: z.string().check(z.minLength(1, 'validation.passwordRequired')),
})

export const signupSchema = z.object({
  username: z
    .string()
    .check(
      z.trim(),
      z.minLength(3, 'validation.usernameLength'),
      z.maxLength(20, 'validation.usernameLength'),
      z.regex(/^[A-Za-z0-9_]+$/, 'validation.usernameChars'),
    ),
  countryCode: z.string().check(z.regex(/^[A-Z]{2}$/, 'validation.countryRequired')),
  email,
  password: z.string().check(z.minLength(8, 'validation.passwordTooShort'), z.maxLength(72, 'validation.passwordTooShort')),
  isAdult: z.literal(true, 'validation.ageRequired'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>

/** First error per field, as i18n keys. */
export function fieldErrors(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '')
    if (field && !out[field]) out[field] = issue.message
  }
  return out
}
