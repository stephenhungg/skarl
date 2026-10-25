// Skarl mark: seven rounded cells on a diagonal checkerboard, joined corner to corner.
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 500 300" width={(size * 500) / 300} height={size} fill="currentColor" aria-hidden="true" className={className}>
      <rect x="100" y="0" width="100" height="100" rx="36" /><rect x="300" y="0" width="100" height="100" rx="36" /><rect x="0" y="100" width="100" height="100" rx="36" /><rect x="200" y="100" width="100" height="100" rx="36" /><rect x="400" y="100" width="100" height="100" rx="36" /><rect x="100" y="200" width="100" height="100" rx="36" /><rect x="300" y="200" width="100" height="100" rx="36" /><path d="M58,100 C85.3,100 100,85.3 100,58 L142,58 L142,100 C114.7,100 100,114.7 100,142 L58,142Z" /><path d="M158,100 C185.3,100 200,114.7 200,142 L242,142 L242,100 C214.7,100 200,85.3 200,58 L158,58Z" /><path d="M58,200 C85.3,200 100,214.7 100,242 L142,242 L142,200 C114.7,200 100,185.3 100,158 L58,158Z" /><path d="M258,200 C285.3,200 300,214.7 300,242 L342,242 L342,200 C314.7,200 300,185.3 300,158 L258,158Z" /><path d="M358,200 C385.3,200 400,185.3 400,158 L442,158 L442,200 C414.7,200 400,214.7 400,242 L358,242Z" /><path d="M358,100 C385.3,100 400,114.7 400,142 L442,142 L442,100 C414.7,100 400,85.3 400,58 L358,58Z" />
    </svg>
  );
}
