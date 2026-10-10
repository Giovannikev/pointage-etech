import type { ReactNode } from "react"

/** Full-height screen centering its content: loading, errors, sign-in. */
export function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-svh place-items-center px-4 py-10">
      {children}
    </div>
  )
}
