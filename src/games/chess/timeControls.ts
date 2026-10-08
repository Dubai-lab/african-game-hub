import * as z from 'zod/mini'

const schema = z.object({
  time_controls: z.array(
    z.object({
      id: z.string().check(z.minLength(1)),
      base_ms: z.int().check(z.positive()),
      increment_ms: z.int().check(z.minimum(0)),
    }),
  ),
})

export type TimeControl = z.infer<typeof schema>['time_controls'][number]
export type Pace = 'bullet' | 'blitz' | 'rapid'

export function parseTimeControls(optionsSchema: unknown): TimeControl[] {
  const parsed = schema.safeParse(optionsSchema)
  return parsed.success ? parsed.data.time_controls : []
}

/** Standard chess pacing, from the expected length of a 40-move game. */
export function paceOf(control: TimeControl): Pace {
  const seconds = (control.base_ms + 40 * control.increment_ms) / 1000
  if (seconds < 180) return 'bullet'
  if (seconds < 600) return 'blitz'
  return 'rapid'
}

/** Minutes, and the increment in seconds when there is one: "5", "3 | 2". Standard notation in every language. */
export function timeControlLabel(control: TimeControl): string {
  const minutes = control.base_ms / 60_000
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)
  return control.increment_ms > 0 ? `${base} | ${control.increment_ms / 1000}` : base
}
