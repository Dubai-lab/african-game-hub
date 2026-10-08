/** A grey block standing in for content that is still loading. */
export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-line/70 ${className}`} aria-hidden="true" />
}
