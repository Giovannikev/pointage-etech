import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "@/i18n"
import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Set while reloading for a missing chunk, so a lasting failure can't loop. */
const CHUNK_RELOAD_KEY = "pointage:chunk-reload"

/*
 * A tab opened before a deployment still asks for the previous chunks,
 * which Netlify no longer serves once the new version is live: opening a
 * page not loaded yet would fail. Reload once to get the new version.
 */
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== null) {
      return
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
  } catch {
    // Storage blocked: reloading once is still the best answer.
  }
  event.preventDefault()
  window.location.reload()
})
// The app loaded: a later missing chunk may reload again.
window.addEventListener("load", () => {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    // Nothing to clean up.
  }
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  </StrictMode>
)
