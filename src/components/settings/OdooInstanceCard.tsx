import { useTranslation } from "react-i18next"

import { SecretInput } from "@/components/settings/SecretInput"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INSTANCE_BACKGROUNDS } from "@/lib/instanceColors"
import { cn } from "@/lib/utils"
import type { OdooInstanceIndex } from "@/types/timesheet"
import {
  isInstanceRequired,
  type OdooInstanceDraft,
} from "@/utils/settingsForm"

const PLACEHOLDERS: Record<OdooInstanceIndex, { label: string; url: string }> =
  {
    1: { label: "Arkeup PMO", url: "https://pmo-buodoo.arkeup.com" },
    2: { label: "Edoo IT", url: "https://www.edoo-it.com" },
  }

const DESCRIPTION_KEYS = {
  1: "settings.odoo.descriptionPrimary",
  2: "settings.odoo.descriptionSecondary",
} as const satisfies Record<OdooInstanceIndex, string>

interface OdooInstanceCardProps {
  index: OdooInstanceIndex
  draft: OdooInstanceDraft
  onChange: (patch: Partial<OdooInstanceDraft>) => void
}

export function OdooInstanceCard({
  index,
  draft,
  onChange,
}: OdooInstanceCardProps) {
  const { t } = useTranslation()
  const required = isInstanceRequired(index, draft)
  const fieldId = (name: string) => `odoo-${index}-${name}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2.5 rounded-full", INSTANCE_BACKGROUNDS[index])}
          />
          {t("settings.odoo.title", { index })}
        </CardTitle>
        <CardDescription>{t(DESCRIPTION_KEYS[index])}</CardDescription>
        {draft.hasStoredApiKey && (
          <CardAction>
            <Badge variant="secondary">{t("settings.connected")}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={fieldId("label")}>
                {t("settings.odoo.name")}
              </FieldLabel>
              <Input
                id={fieldId("label")}
                value={draft.label}
                placeholder={PLACEHOLDERS[index].label}
                maxLength={60}
                required={required}
                onChange={(event) => onChange({ label: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={fieldId("url")}>
                {t("settings.odoo.url")}
              </FieldLabel>
              <Input
                id={fieldId("url")}
                type="url"
                value={draft.url}
                placeholder={PLACEHOLDERS[index].url}
                required={required}
                onChange={(event) => onChange({ url: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={fieldId("db")}>
                {t("settings.odoo.database")}
              </FieldLabel>
              <Input
                id={fieldId("db")}
                value={draft.db}
                placeholder={t("settings.odoo.databasePlaceholder")}
                spellCheck={false}
                onChange={(event) => onChange({ db: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={fieldId("login")}>
                {t("settings.odoo.login")}
              </FieldLabel>
              <Input
                id={fieldId("login")}
                value={draft.login}
                placeholder="me@company.com"
                autoComplete="username"
                required={required}
                onChange={(event) => onChange({ login: event.target.value })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={fieldId("api-key")}>
              {t("settings.odoo.apiKey")}
            </FieldLabel>
            <SecretInput
              id={fieldId("api-key")}
              value={draft.apiKey}
              placeholder={
                draft.hasStoredApiKey ? t("settings.storedSecret") : ""
              }
              required={required && !draft.hasStoredApiKey}
              onChange={(event) => onChange({ apiKey: event.target.value })}
            />
            <FieldDescription>{t("settings.odoo.apiKeyHint")}</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
