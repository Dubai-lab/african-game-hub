// Build-time only: renders a route to an HTML string. Used by scripts/prerender.ts.
import { StrictMode } from 'react'
import { prerender } from 'react-dom/static'
import '@/core/i18n'
import App from './App'

export async function render(location: string): Promise<string> {
  const { prelude } = await prerender(
    <StrictMode>
      <App staticLocation={location} />
    </StrictMode>,
  )
  return new Response(prelude).text()
}
