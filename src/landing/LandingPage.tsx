import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { applyDetectedLanguage } from '@/core/i18n'
import { buttonClass } from '@/core/ui/Button'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'
import { HeroVisual } from './hero3d/HeroVisual'
import { useLandingTerms } from './landingData'
import { Band, Countries, FairPlay, Footer, Games, HowItWorks, LiveNumbers } from './sections'

// The approved design: one showpiece (the opponent's move in the hero), everything else calm.
// This page is also saved as static HTML at build time (scripts/prerender.ts), so its first
// render must not depend on anything only the browser knows.
export default function LandingPage() {
  const { t, i18n } = useTranslation()
  const { status } = useAuth()
  const terms = useLandingTerms()
  // Runs only after this page has attached to its prerendered (English) HTML.
  useEffect(applyDetectedLanguage, [])
  const signedIn = status === 'authenticated'
  const playHref = signedIn ? '/lobby' : '/signup'
  const tokens = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en').format(terms.signupBonus),
    [i18n.resolvedLanguage, terms.signupBonus],
  )

  return (
    <div className="overflow-x-clip">
      <section className="relative overflow-hidden bg-primary text-surface">
        <div className="mx-auto w-full max-w-6xl px-5">
          <header className="flex items-center justify-between gap-3 py-4">
            <span className="font-display text-lg font-extrabold">{t('app.name')}</span>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              {!signedIn && (
                <Link to="/login" className="flex min-h-10 items-center font-bold underline underline-offset-4">
                  {t('landing.login')}
                </Link>
              )}
            </div>
          </header>

          <div className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-4 lg:pb-10">
            <div className="pt-8 lg:col-span-5 lg:pt-0">
              <h1 className="font-display text-[3.5rem] font-extrabold leading-[0.95] lg:text-[6.5rem]">
                {t('landing.hero.headline')}
              </h1>
              <p className="mt-4 max-w-sm text-lg text-primary-tint">{t('landing.hero.sub', { tokens })}</p>
              <div className="mt-6 flex flex-col gap-3 sm:max-w-xs">
                <Link to={playHref} className={buttonClass('primary', 'min-h-14 text-lg')}>
                  {signedIn ? t('landing.goToLobby') : t('landing.hero.cta')}
                </Link>
                {!signedIn && (
                  <Link to="/login" className="flex min-h-10 items-center justify-center text-sm font-semibold underline underline-offset-4 sm:justify-start">
                    {t('landing.hero.haveAccount')}
                  </Link>
                )}
              </div>
            </div>
            {/* The board runs off the edge of the screen on purpose. */}
            <div className="-mx-5 -mb-6 mt-4 lg:col-span-7 lg:-mr-28 lg:mb-0 lg:ml-0 lg:mt-0">
              <HeroVisual />
            </div>
          </div>
        </div>
      </section>
      <Band />

      <main>
        <Games playHref={playHref} />
        <HowItWorks />
        <LiveNumbers />
        <FairPlay />
        <Band />
        <Countries />
      </main>
      <Footer />
    </div>
  )
}
