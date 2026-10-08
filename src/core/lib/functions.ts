import { FunctionsHttpError } from '@supabase/supabase-js'
import i18n from '@/core/i18n'
import { supabase } from './supabase'

export type FunctionReply<T> = ({ ok: true } & T) | { ok: false; code: string }

/**
 * Calls an Edge Function as the signed-in player.
 * Resolves with the function's answer, including an expected "no" ({ok: false, code}).
 * Rejects only when the server could not be reached at all, so callers can tell
 * "the server refused" from "you are offline".
 */
export async function callFunction<T = Record<string, never>>(
  name: string,
  body: Record<string, unknown>,
): Promise<FunctionReply<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data as FunctionReply<T>
  if (error instanceof FunctionsHttpError) {
    try {
      const reply = (await error.context.json()) as { code?: unknown }
      if (typeof reply.code === 'string') return { ok: false, code: reply.code }
    } catch {
      // The error body was not ours; fall through.
    }
    return { ok: false, code: 'SERVER_ERROR' }
  }
  throw error
}

/** A player-facing sentence for a refusal code. Unknown codes get the general message. */
export function refusalMessage(code: string): string {
  return i18n.t(`errors.codes.${code}`, { defaultValue: i18n.t('errors.generic') })
}
