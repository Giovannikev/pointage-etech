import { useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { NewPasswordFields } from "@/components/auth/NewPasswordFields"
import { BrandMark } from "@/components/BrandMark"
import { CenteredScreen } from "@/components/CenteredScreen"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { updatePassword } from "@/services/authService"
import {
  EMPTY_NEW_PASSWORD,
  newPasswordProblem,
  type NewPasswordDraft,
} from "@/utils/password"

interface ResetPasswordPageProps {
  email: string
  /** Opens the app once the password is set (or put off). */
  onDone: () => void
}

/** Opened from a password reset link: the user picks a new password. */
export function ResetPasswordPage({ email, onDone }: ResetPasswordPageProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<NewPasswordDraft>(EMPTY_NEW_PASSWORD)
  const [isSaving, setIsSaving] = useState(false)
  const canSubmit = newPasswordProblem(draft) === null && !isSaving

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    setIsSaving(true)
    try {
      await updatePassword(draft.password)
      toast.success(t("password.changed"), {
        description: t("password.changedDescription"),
      })
      onDone()
    } catch (error) {
      toast.error(t("password.changeError"), {
        description: error instanceof Error ? error.message : undefined,
      })
      setIsSaving(false)
    }
  }

  return (
    <CenteredScreen>
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="mb-2 flex items-center gap-2 font-semibold">
            <BrandMark />
            Pointage
          </span>
          <CardTitle>{t("password.resetTitle")}</CardTitle>
          <CardDescription>
            {t("password.resetDescription", { email })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              readOnly
              hidden
            />
            <FieldGroup>
              <NewPasswordFields
                idPrefix="reset"
                value={draft}
                onChange={setDraft}
                disabled={isSaving}
              />
              <Button type="submit" size="lg" disabled={!canSubmit}>
                {isSaving && <Loader2Icon className="animate-spin" />}
                {t("password.save")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={isSaving}
            onClick={onDone}
          >
            {t("password.later")}
          </Button>
        </CardFooter>
      </Card>
    </CenteredScreen>
  )
}
