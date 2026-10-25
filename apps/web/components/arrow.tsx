// The small boxed arrow used after section titles and on secondary actions.
export function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 12" width="21" height="12" fill="none" aria-hidden="true" className={className}>
      <rect x="0.5" y="0.5" width="20" height="11" rx="5.5" stroke="currentColor" />
      <path d="M6 6h8m-2.5-2.5L14 6l-2.5 2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CircleArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8h6m-2.2-2.2L11 8l-2.2 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
