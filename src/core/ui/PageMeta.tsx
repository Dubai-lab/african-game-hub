// What a search engine and a browser tab are told about the page on show: its title, a sentence
// about it, its one true address, and whether it belongs in search results at all.
//
// Only the pages anyone may read belong there: the landing page, the sign-up and log-in pages
// and the policies. Everything behind the log-in, and any address that is not a page, is marked
// "do not list". The landing page's own tags are also written into its HTML at build time
// (index.html); this keeps them right as the visitor moves about and changes language.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

/** The address the hub is published at. Set at build time; the address in use otherwise. */
const SITE = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '')

/** Public pages: where each finds its title and its sentence in the translations. */
export const PUBLIC_PAGES: Record<string, { title: string; description?: string }> = {
  '/': { title: 'seo.homeTitle', description: 'seo.homeDescription' },
  '/signup': { title: 'auth.signupTitle', description: 'seo.signupDescription' },
  '/login': { title: 'auth.loginTitle', description: 'seo.loginDescription' },
  '/terms': { title: 'legal.terms.title' },
  '/privacy': { title: 'legal.privacy.title' },
  '/cookies': { title: 'legal.cookies.title' },
  '/refunds': { title: 'legal.refunds.title' },
  '/responsible-gaming': { title: 'legal.responsible.title' },
}

function setTag(selector: string, make: () => HTMLElement, attribute: string, value: string | null) {
  let tag = document.head.querySelector<HTMLElement>(selector)
  if (value === null) {
    tag?.remove()
    return
  }
  if (!tag) {
    tag = make()
    document.head.appendChild(tag)
  }
  tag.setAttribute(attribute, value)
}

const meta = (name: string) => () => Object.assign(document.createElement('meta'), { name })
const link = (rel: string) => () => Object.assign(document.createElement('link'), { rel })

export function PageMeta() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const page = PUBLIC_PAGES[path]
  const language = i18n.resolvedLanguage

  useEffect(() => {
    const name = t('app.name')
    const fallback = t('seo.homeDescription')
    document.title = !page ? name : path === '/' ? t(page.title) : `${t(page.title)} | ${name}`
    setTag('meta[name="description"]', meta('description'), 'content', page?.description ? t(page.description) : fallback)
    setTag('link[rel="canonical"]', link('canonical'), 'href', page ? `${SITE ?? window.location.origin}${path}` : null)
    setTag('meta[name="robots"]', meta('robots'), 'content', page ? 'index, follow, max-image-preview:large' : 'noindex')
    // `language` is here so the tags follow a change of language.
  }, [page, path, t, language])

  return null
}
