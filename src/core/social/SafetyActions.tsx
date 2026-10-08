import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/core/ui/toast'
import { Button } from '@/core/ui/Button'
import { REPORT_REASONS, type ReportReason, reportPlayer, useBlocking } from './social'

// Block and report: the two things a player can do about another player by themselves.
// A report goes to the admin team with a copy of what was said; a block closes every channel
// between the two at once. Both are enforced by the server.

type Target = { userId: string; name: string }

export function ReportDialog({ target, matchId, onClose }: { target: Target; matchId?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const blocking = useBlocking()
  const [reason, setReason] = useState<ReportReason>('abuse')
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const sent = await reportPlayer(target.userId, reason, note, matchId)
    if (sent && alsoBlock) await blocking.block(target.userId, target.name)
    setBusy(false)
    if (sent) {
      toast.success(t('safety.sent'))
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('safety.reportTitle', { name: target.name })}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-4 border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:border-4"
      >
        <h2 className="font-display text-2xl font-extrabold text-primary">{t('safety.reportTitle', { name: target.name })}</h2>
        <p className="text-sm text-muted">{t(matchId ? 'safety.explainMatch' : 'safety.explain')}</p>

        <label className="text-sm font-semibold">
          {t('safety.reasonLabel')}
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReason)}
            className="mt-1 min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base"
          >
            {REPORT_REASONS.map((value) => (
              <option key={value} value={value}>
                {t(`safety.reasons.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold">
          {t('safety.noteLabel')}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={3}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-base"
          />
        </label>

        {!blocking.isBlocked(target.userId) && (
          <label className="flex min-h-10 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} className="size-5" />
            {t('safety.alsoBlock')}
          </label>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            {t('safety.cancel')}
          </Button>
          <Button type="submit" className="flex-1" disabled={busy}>
            {t('safety.send')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** "Report" and "Block / Unblock", as shown on another player's profile. */
export function SafetyActions({ target }: { target: Target }) {
  const { t } = useTranslation()
  const blocking = useBlocking()
  const [reporting, setReporting] = useState(false)
  const blocked = blocking.isBlocked(target.userId)
  const link = 'min-h-10 text-sm font-semibold text-primary underline underline-offset-4'

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-5" data-testid="safety-actions">
      <button type="button" className={link} onClick={() => setReporting(true)}>
        {t('safety.report')}
      </button>
      <button
        type="button"
        className={link}
        disabled={!blocking.loaded}
        onClick={() => void (blocked ? blocking.unblock(target.userId, target.name) : blocking.block(target.userId, target.name))}
      >
        {t(blocked ? 'safety.unblock' : 'safety.block')}
      </button>
      {blocked && <p className="basis-full text-sm text-muted">{t('safety.blockedNote')}</p>}
      {reporting && <ReportDialog target={target} onClose={() => setReporting(false)} />}
    </div>
  )
}
