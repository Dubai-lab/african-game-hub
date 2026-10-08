import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '@fontsource-variable/ojuju/wght.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import { applyDetectedLanguage } from '@/core/i18n'
import './index.css'
import App from './App'

const container = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// The landing page arrives as ready-made HTML (see scripts/prerender.ts): attach to it instead
// of drawing it again. Every other route starts from an empty root.
if (window.location.pathname === '/' && container.hasChildNodes()) {
  // The landing page switches language itself once it has attached (see LandingPage).
  hydrateRoot(container, app)
} else {
  container.textContent = ''
  applyDetectedLanguage()
  createRoot(container).render(app)
}
