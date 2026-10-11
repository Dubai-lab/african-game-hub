// The bar at the bottom of a signed-in page, above the tabs, for the one thing the page is for
// (the Play button on a game's page).
//
// On a phone it is part of the app's frame, like the top bar: closed off by a line, never moving,
// with the page scrolling between the two. It is never laid over the page. The frame (AppShell)
// owns the bar; a page puts something in it with <PageDock>. On a computer there is no such
// bar, and what the page gives is shown where the page puts it.
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** The id of the bar in the frame. */
export const PAGE_DOCK_ID = 'page-dock'
const WIDE = '(min-width: 1024px)'

export function PageDock({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  // The bar is in the page once the frame has been drawn.
  useEffect(() => {
    setDock(wide ? null : document.getElementById(PAGE_DOCK_ID))
  }, [wide])

  if (wide) return <div className={className}>{children}</div>
  return dock ? createPortal(children, dock) : null
}
