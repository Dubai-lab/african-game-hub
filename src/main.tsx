import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '@fontsource-variable/ojuju/wght.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import { applyDetectedLanguage } from '@/core/i18n'
import { leaveOldHome } from '@/core/lib/movedHome'
import { startNativeApp } from '@/core/lib/nativeApp'
import { applyOwnFlags } from '@/core/ui/flagFont'
import './index.css'
import App from './App'

// Before anything is drawn: flags for computers that have none of their own.
applyOwnFlags()
// Inside the Android app: what the phone's Back button does.
startNativeApp()

const container = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// An installed copy opened at the hub's old address goes to the new one, and draws nothing here.
if (leaveOldHome()) {
  // On its way.
}
// The landing page arrives as ready-made HTML (see scripts/prerender.ts): attach to it instead
// of drawing it again. Every other route starts from an empty root.
else if (window.location.pathname === '/' && container.hasChildNodes()) {
  // The landing page switches language itself once it has attached (see LandingPage).
  hydrateRoot(container, app)
} else {
  container.textContent = ''
  applyDetectedLanguage()
  createRoot(container).render(app)
}
