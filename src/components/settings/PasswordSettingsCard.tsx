import { useState, type FormEvent } from "react"
import { Loader2Icon, MailIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { NewPasswordFields } from "@/components/auth/NewPasswordFields"
import { PasswordInput } from "@/components/auth/PasswordInput"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  changePassword,
  requestPasswordReset,
  WrongPasswordError,
} from "@/services/authService"
import {
  EMPTY_NEW_PASSWORD,
  newPasswordProblem,
  type NewPasswordDraft,
} from "@/utils/password"

interface PasswordSettingsCardProps {
  email: string
}

/**
 * Changes the account password (the current one is checked first), or
 * emails a reset link when the current one is forgotten.
 */
export function PasswordSettingsCard({ email }: PasswordSettingsCardProps) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState<NewPasswordDraft>(EMPTY_NEW_PASSWORD)
  const [isWrongCurrent, setIsWrongCurrent] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingLink, setIsSendingLink] = useState(false)

  const problem = newPasswordProblem(next)
  const isSameAsCurrent = current !== "" && next.password === current
  const canSubmit =
    current !== "" && problem === null && !isSameAsCurrent && !isSaving

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    setIsSaving(true)
    try {
      await changePassword(current, next.password)
      setCurrent("")
      setNext(EMPTY_NEW_PASSWORD)
      toast.success(t("password.changed"), {
        description: t("password.changedDescription"),
      })
    } catch (error) {
      if (error instanceof WrongPasswordError) {
        setIsWrongCurrent(true)
      } else {
        toast.error(t("password.changeError"), {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  const sendResetLink = async (): Promise<void> => {
    setIsSendingLink(true)
    try {
      await requestPasswordReset(email)
      toast.success(t("password.linkSent"), {
        description: t("password.linkSentTo", { email }),
      })
    } catch (error) {
      toast.error(t("password.linkError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSendingLink(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("password.title")}</CardTitle>
        <CardDescription>
          {t("password.description", { email })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="password-form" onSubmit={handleSubmit}>
          {/* Lets password managers tie the new password to the account. */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <FieldGroup>
            <Field data-invalid={isWrongCurrent || undefined}>
              <FieldLabel htmlFor="password-current">
                {t("password.current")}
              </FieldLabel>
              <PasswordInput
                id="password-current"
                autoComplete="current-password"
                required
                disabled={isSaving}
                aria-invalid={isWrongCurrent || undefined}
                value={current}
                onChange={(event) => {
                  setCurrent(event.target.value)
                  setIsWrongCurrent(false)
                }}
              />
              {isWrongCurrent && (
                <FieldError>{t("password.wrongCurrent")}</FieldError>
              )}
            </Field>
            <NewPasswordFields
              idPrefix="password"
              value={next}
              onChange={setNext}
              disabled={isSaving}
            />
            {isSameAsCurrent && (
              <FieldError>{t("password.sameAsCurrent")}</FieldError>
            )}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 border-t">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 whitespace-normal"
          disabled={isSendingLink}
          onClick={() => void sendResetLink()}
        >
          {isSendingLink ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <MailIcon />
          )}
          {t("password.forgotCurrent")}
        </Button>
        <Button type="submit" form="password-form" disabled={!canSubmit}>
          {isSaving && <Loader2Icon className="animate-spin" />}
          {t("password.change")}
        </Button>
      </CardFooter>
    </Card>
  )
}
