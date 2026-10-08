/** An on/off setting with its label, the whole row tappable. */
export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} className="size-6 shrink-0 accent-primary" />
    </label>
  )
}
