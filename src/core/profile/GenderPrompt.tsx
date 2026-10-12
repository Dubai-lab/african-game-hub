import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { type Gender, PlayerFigure } from '@/core/ui/PlayerFigure'
import { toast } from '@/core/ui/toast'
import { myProfileKey, useMyProfile } from './useMyProfile'

export const GENDERS: readonly Gender[] = ['male', 'female']

/** The two choices, as large buttons with the figure each one gives. Used here and when signing up. */
export function GenderChoice({ value, onChange, name, invalid = false }: { value: Gender | null; onChange: (gender: Gender) => void; name: string; invalid?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2">
      {GENDERS.map((gender, index) => (
        <label
          key={gender}
          className={`flex min-h-14 cursor-pointer items-center justify-center gap-2 border-2 px-3 py-1 font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${gender === value ? 'border-ink bg-brand text-brand-ink' : invalid ? 'border-danger bg-panel text-ink' : 'border-line bg-panel text-ink'}`}
        >
          <input type="radio" name={name} className="sr-only" checked={gender === value} onChange={() => onChange(gender)} aria-invalid={invalid ? true : undefined} />
          <PlayerFigure kind={gender} seatIndex={index} className="size-9" />
          {t(`auth.gender.${gender}`)}
        </label>
      ))}
    </div>
  )
}

/**
 * Players who joined before the question was asked are asked once, when they next open the
 * app. Once answered it is never shown again. It cannot be put aside: the answer chooses the
 * figure other players see at this player's place.
 */
export function GenderPrompt() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const profile = useMyProfile()
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<Gender | null>(null)
  const [busy, setBusy] = useState(false)

  if (!profile.data || profile.data.gender !== null) return null

  async function save() {
    if (!choice || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('set_my_gender', { p_gender: choice })
      if (error) return toast.error(t('errors.network'))
      await queryClient.invalidateQueries({ queryKey: myProfileKey(user?.id) })
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="gender-prompt-title" className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:border-4" data-testid="gender-prompt">
        <h2 id="gender-prompt-title" className="font-display text-2xl font-extrabold text-primary">
          {t('auth.gender.promptTitle')}
        </h2>
        <p className="mt-1 text-muted">{t('auth.gender.promptBody')}</p>
        <div className="mt-4">
          <GenderChoice value={choice} onChange={setChoice} name="gender-prompt" />
        </div>
        <Button className="mt-5 w-full" disabled={!choice || busy} onClick={() => void save()}>
          {busy ? t('auth.working') : t('auth.gender.save')}
        </Button>
      </div>
    </div>
  )
}
