import { RotateCwIcon, SparklesIcon, XIcon } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { hardReload } from "@/hooks/useVersionCheck"

/** ⌘ on Apple keyboards, Ctrl everywhere else. */
function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-b-2 bg-background px-1.5 font-sans text-xs font-semibold text-foreground">
      {children}
    </kbd>
  )
}

/** The hard-reload shortcut, drawn as keyboard keys. */
function ReloadShortcut() {
  const keys = [isApplePlatform() ? "⌘" : "Ctrl", "Shift", "R"]
  return (
    <span className="inline-flex items-center gap-1 align-middle whitespace-nowrap">
      {keys.map((key, position) => (
        <span key={key} className="inline-flex items-center gap-1">
          {position > 0 && (
            <span aria-hidden className="text-muted-foreground">
              +
            </span>
          )}
          <Key>{key}</Key>
        </span>
      ))}
    </span>
  )
}

interface UpdateBannerProps {
  onDismiss: () => void
}

/**
 * Tells that a newer version is online and how to load it. Stays on screen
 * until the page reloads or the user closes it.
 */
export function UpdateBanner({ onDismiss }: UpdateBannerProps) {
  const { t } = useTranslation()

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex justify-center px-3">
      <section
        role="status"
        aria-live="polite"
        aria-label={t("update.title")}
        className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-primary/30 bg-popover p-3 pr-2 text-popover-foreground shadow-lg sm:items-center"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <SparklesIcon className="size-4" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-1 text-sm">
          <p className="font-semibold">{t("update.title")}</p>
          <p className="leading-relaxed text-muted-foreground">
            <Trans
              i18nKey="update.message"
              components={{ keys: <ReloadShortcut /> }}
            />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" onClick={() => void hardReload()}>
            <RotateCwIcon />
            <span className="max-sm:sr-only">{t("update.reloadAction")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={t("update.dismiss")}
            onClick={onDismiss}
          >
            <XIcon />
          </Button>
        </div>
      </section>
    </div>
  )
}
