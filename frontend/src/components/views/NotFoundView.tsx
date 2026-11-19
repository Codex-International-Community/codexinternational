import { Icon } from '../common/Icon'

interface NotFoundViewProps {
  path: string
  onGoHome: () => void
  onGoBack: () => void
}

export function NotFoundView({ path, onGoHome, onGoBack }: NotFoundViewProps) {
  return (
    <div className="page-scroll">
      <section className="route-not-found" aria-labelledby="route-not-found-title">
        <span className="route-not-found-code" aria-hidden="true">404</span>
        <h1 id="route-not-found-title">Page not found</h1>
        <p>The address may be incorrect, or this page may have moved.</p>
        <code>{path}</code>
        <div className="route-not-found-actions">
          <button type="button" className="primary-action" onClick={onGoHome}>
            <Icon name="home" size={16} />
            Go to Home
          </button>
          <button type="button" className="route-not-found-back" onClick={onGoBack}>
            Go back
          </button>
        </div>
      </section>
    </div>
  )
}
