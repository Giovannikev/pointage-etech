import { Trans, useTranslation } from "react-i18next"

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
import type { GithubSettings } from "@/types/settings"
import type { SettingsDraft } from "@/utils/settingsForm"

type GithubDraft = Pick<SettingsDraft, "githubToken" | "authorEmails">

interface GithubSettingsCardProps {
  draft: SettingsDraft
  stored: GithubSettings | null
  onChange: (patch: Partial<GithubDraft>) => void
}

export function GithubSettingsCard({
  draft,
  stored,
  onChange,
}: GithubSettingsCardProps) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.github.title")}</CardTitle>
        <CardDescription>{t("settings.github.description")}</CardDescription>
        {stored !== null && (
          <CardAction>
            <Badge variant="secondary">
              {t("settings.github.connectedAs", { login: stored.login })}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="github-token">
              {t("settings.github.token")}
            </FieldLabel>
            <SecretInput
              id="github-token"
              value={draft.githubToken}
              placeholder={
                draft.hasStoredGithubToken
                  ? t("settings.storedSecret")
                  : "ghp_… or github_pat_…"
              }
              required={!draft.hasStoredGithubToken}
              onChange={(event) =>
                onChange({ githubToken: event.target.value })
              }
            />
            <FieldDescription>
              <Trans
                i18nKey="settings.github.tokenHint"
                components={{ code: <code /> }}
              />
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="github-author-emails">
              {t("settings.github.otherEmails")}
            </FieldLabel>
            <Input
              id="github-author-emails"
              value={draft.authorEmails}
              placeholder="me@company.com"
              spellCheck={false}
              onChange={(event) =>
                onChange({ authorEmails: event.target.value })
              }
            />
            <FieldDescription>
              {t("settings.github.otherEmailsHint")}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
