import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonClass } from './Button'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.body')}</p>
      <Link to="/" className={buttonClass('primary', 'mt-4')}>
        {t('common.backHome')}
      </Link>
    </div>
  )
}
