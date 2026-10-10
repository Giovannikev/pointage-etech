import { MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { t } = useTranslation()
  const { setTheme } = useTheme()

  const toggle = (): void => {
    const isDark = document.documentElement.classList.contains("dark")
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={t("theme.toggle")}
      title={t("theme.toggleHint")}
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </Button>
  )
}
