import { CheckIcon, LanguagesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SUPPORTED_LANGUAGES, toLanguage } from "@/i18n"

/** Language menu; the choice is remembered on this device. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const current = toLanguage(i18n.resolvedLanguage)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("language.change")}
          title={t("language.change")}
        >
          <LanguagesIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map(({ code, label }) => (
          <DropdownMenuItem
            key={code}
            lang={code}
            onSelect={() => void i18n.changeLanguage(code)}
          >
            {label}
            {code === current && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
