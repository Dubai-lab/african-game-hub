import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SOCIAL_LINKS, type SocialPage } from '@/core/lib/socialLinks'
import { Button, buttonClass } from './Button'

// The hub's pages elsewhere, each with a small sign of its own. The signs are plain drawings
// made here (a musical note, a cross), in the colour of the text around them; see ASSETS.md.

function Sign({ id }: { id: SocialPage['id'] }) {
  const common = { viewBox: '0 0 24 24', className: 'size-5', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  if (id === 'tiktok') {
    return (
      <svg {...common} strokeWidth="2.6">
        <path d="M13.5 4v10.6a3.9 3.9 0 1 1-3.9-3.9" />
        <path d="M13.5 4c.3 2.7 2.3 4.6 5 4.9" />
      </svg>
    )
  }
  return (
    <svg {...common} strokeWidth="2.6">
      <path d="M5 4.5 19 19.5" />
      <path d="M19 4.5 5 19.5" strokeWidth="1.5" />
    </svg>
  )
}

/** One page: its sign in a disc, then its name. Opens in a new tab. */
function PageLink({ page, className = '' }: { page: SocialPage; className?: string }) {
  return (
    <a href={page.url} target="_blank" rel="noopener noreferrer" className={`flex min-h-11 items-center gap-3 font-semibold ${className}`} data-social={page.id}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
        <Sign id={page.id} />
      </span>
      <span className="underline underline-offset-4">{page.name}</span>
    </a>
  )
}

/** The pages as a list under a "Follow us" heading (the landing page's footer). */
export function FollowList({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  if (SOCIAL_LINKS.length === 0) return null
  return (
    <div className={className} data-testid="footer-follow">
      <h2 className="font-display text-lg font-extrabold">{t('social.follow')}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {SOCIAL_LINKS.map((page) => (
          <li key={page.id}>
            <PageLink page={page} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One button that opens the pages in a panel: however many pages there come to be, Settings stays short. */
export function FollowButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (SOCIAL_LINKS.length === 0) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass('ghost', className)} data-testid="follow-open">
        {t('social.follow')}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={() => setOpen(false)} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('social.follow')}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 text-ink sm:border-4"
            data-testid="follow-panel"
          >
            <h2 className="font-display text-2xl font-extrabold text-primary">{t('social.follow')}</h2>
            <p className="mt-1 text-muted">{t('social.hint')}</p>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {SOCIAL_LINKS.map((page) => (
                <li key={page.id}>
                  <PageLink page={page} className="py-2" />
                </li>
              ))}
            </ul>
            <Button className="mt-4 w-full" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
