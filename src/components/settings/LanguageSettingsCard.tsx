import { useTranslation } from "react-i18next"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SUPPORTED_LANGUAGES, toLanguage } from "@/i18n"

/** Interface language; the choice is remembered on this device. */
export function LanguageSettingsCard() {
  const { t, i18n } = useTranslation()
  const current = toLanguage(i18n.resolvedLanguage)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("language.title")}</CardTitle>
        <CardDescription>{t("language.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label={t("language.change")}
          value={current}
          onValueChange={(code) => {
            if (code !== "") void i18n.changeLanguage(code)
          }}
        >
          {SUPPORTED_LANGUAGES.map(({ code, label }) => (
            <ToggleGroupItem key={code} value={code} lang={code}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}
