export function EmptyState({
    title,
    hint,
  }: {
    title: string
    hint?: string
  }) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">{title}</p>
        {hint && <p className="empty-state__hint">{hint}</p>}
      </div>
    )
  }
  
  export function ErrorState({
    message,
    onRetry,
  }: {
    message: string
    onRetry?: () => void
  }) {
    return (
      <div className="error-state">
        <p>{message}</p>
        {onRetry && <button onClick={onRetry}>Retry</button>}
      </div>
    )
  }