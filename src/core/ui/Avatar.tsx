import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/core/settings/settingsStore'

type Props = {
  /** The player's photo, when they have one. */
  url?: string | null
  /** Whose it is. Without a photo (or with data saver on) the first letter is shown instead. */
  name: string
  /** Size and any frame: for example "size-11 border-2 border-ink". */
  className?: string
  /** Colours of the letter tile, when the screen has its own (a chess player's side, say). */
  tileClassName?: string
}

/**
 * A player's picture. Decoration: the name is always written next to it, so it is hidden from
 * screen readers. With data saver on, no photo is fetched at all.
 */
export function Avatar({ url, name, className = '', tileClassName = 'bg-primary text-surface' }: Props) {
  const dataSaver = useSettingsStore((state) => state.dataSaver)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])

  if (url && !dataSaver && !failed) {
    return <img src={url} alt="" width={256} height={256} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`shrink-0 object-cover ${className}`} data-testid="avatar-photo" />
  }
  return (
    <div aria-hidden="true" className={`flex shrink-0 items-center justify-center font-display font-extrabold ${tileClassName} ${className}`}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}
