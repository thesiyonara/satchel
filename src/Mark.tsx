// The Satchel mark: a bag with a flap, a handle and a buckle, drawn in one colour. The gap under the flap takes the surface it sits on
// (`--mark-gap`, the page background unless a parent says otherwise) and the buckle the accent, so the same shape works everywhere.
import { useId } from 'react';

export function Mark({ size = 20, accent = true }: { size?: number; accent?: boolean }) {
  const id = useId();
  return <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" fill="none">
    <clipPath id={id}><rect x="4" y="12" width="40" height="31" rx="9" /></clipPath>
    <path d="M18 14 C18 6.5 30 6.5 30 14" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <rect x="4" y="12" width="40" height="31" rx="9" fill="currentColor" />
    <path d="M4 20 C4 27 8.5 30.5 14 30.5 H34 C39.5 30.5 44 27 44 20" stroke="var(--mark-gap, var(--bg))" strokeWidth="2.6" clipPath={`url(#${id})`} />
    <rect x="21.3" y="27" width="5.4" height="9" rx="2.2" fill={accent ? 'var(--accent)' : 'var(--mark-gap, var(--bg))'} />
  </svg>;
}
