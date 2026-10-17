import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonClass } from '@/core/ui/Button'

/** Online street basketball is not open yet: say so, and offer practice. */
export default function BasketballMatchPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-(--app-h) flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-accent">{t('basketball.onlineSoon')}</h1>
      <Link to="/play/basketball/practice" className={buttonClass('primary')}>
        {t('basketball.practice.link')}
      </Link>
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('basketball.pause.leave')}
      </Link>
    </div>
  )
}
