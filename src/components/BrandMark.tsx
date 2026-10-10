import { cn } from "@/lib/utils"

/**
 * Pointage logo: a "P" whose bowl is a commit node. Same artwork as
 * public/favicon.svg; the colors follow the theme.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <g
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-background"
      >
        <path d="M11 24.5V8" />
        <circle cx="16.5" cy="13.5" r="5.5" />
      </g>
    </svg>
  )
}
