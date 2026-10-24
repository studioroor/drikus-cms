export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand-700" />
      {/* The D as a little character in profile, facing right */}
      <path
        d="M10 6H15A10 10 0 0 1 24.54 13C26.6 12.8 28.4 14.8 28 16.8C27.7 18.4 26.2 18.9 24.7 18.6A10 10 0 0 1 15 26H10A2 2 0 0 1 8 24V8A2 2 0 0 1 10 6Z"
        fill="#fff"
      />
      <circle cx="17.6" cy="18" r="1.5" fill="#fda4af" opacity="0.75" />
      <ellipse cx="20.2" cy="12.4" rx="1.5" ry="2" className="fill-brand-700" />
      <circle cx="20.7" cy="11.7" r="0.55" fill="#fff" />
      <path
        d="M18.4 20.8Q21 22.8 23.2 20.8"
        fill="none"
        className="stroke-brand-700"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
