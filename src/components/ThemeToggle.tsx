import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const THEME_OPTIONS = [
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
  { value: "system", icon: MonitorIcon },
] as const

/** Light, dark, or following the system's setting; remembered on this device. */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("theme.change")}
          title={t("theme.changeHint")}
        >
          {theme === "system" ? (
            <MonitorIcon />
          ) : (
            <>
              <SunIcon className="hidden dark:block" />
              <MoonIcon className="dark:hidden" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon />
            {t(`theme.${value}`)}
            {value === theme && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
