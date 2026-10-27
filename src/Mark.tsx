// The Satchel mark: a solid block with a strap across it. The strap is a gap, so the mark works in one colour
// and the accent only shows where the parent sets it.
import { useId } from 'react';

export function Mark({ size = 20, accent = true }: { size?: number; accent?: boolean }) {
  const id = useId();
  return <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" fill="none">
    <clipPath id={id}><rect x="6" y="6" width="36" height="36" rx="11" /></clipPath>
    <rect x="6" y="6" width="36" height="36" rx="11" fill="currentColor" />
    <path d="M44 -2 L52 6 L6 52 L-2 44 Z" fill={accent ? 'var(--accent)' : 'var(--bg)'} clipPath={`url(#${id})`} />
  </svg>;
}
