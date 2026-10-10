import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "@/i18n"
import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

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
