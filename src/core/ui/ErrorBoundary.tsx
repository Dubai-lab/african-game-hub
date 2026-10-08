import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { Button } from './Button'

type Props = { children: ReactNode; fullScreen?: boolean }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <ErrorFallback fullScreen={this.props.fullScreen} onRetry={() => this.setState({ error: null })} />
  }
}

function ErrorFallback({ fullScreen, onRetry }: { fullScreen?: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-4 px-6 py-12 text-center ${fullScreen ? 'min-h-dvh' : ''}`}
    >
      <p className="text-lg font-semibold">{t('errors.sectionCrashed')}</p>
      <div className="flex gap-3">
        <Button onClick={onRetry}>{t('common.retry')}</Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      </div>
    </div>
  )
}

/** Boundary for routed content: a crash on one page clears when the player navigates away. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
}
