import { useState, type FormEvent } from "react"
import { Loader2Icon, MailCheckIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { PasswordInput } from "@/components/auth/PasswordInput"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  initialAuthRedirect,
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  signIn,
  signUp,
} from "@/services/authService"

/** "forgot": asks for the address to send a password reset link to. */
type AuthMode = "signIn" | "signUp" | "forgot"

/** An expired or already used email link brought the user here. */
const hasExpiredLink = initialAuthRedirect?.kind === "error"

function ForgotPasswordForm({
  email,
  onEmailChange,
}: {
  email: string
  onEmailChange: (email: string) => void
}) {
  const { t } = useTranslation()
  const [isSending, setIsSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    setIsSending(true)
    try {
      await requestPasswordReset(email)
      setSentTo(email.trim())
    } catch (error) {
      toast.error(t("password.linkError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSending(false)
    }
  }

  if (sentTo !== null) {
    return (
      <div
        role="status"
        className="grid justify-items-center gap-3 text-center"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <MailCheckIcon className="size-5" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">
          {t("password.linkSentTo", { email: sentTo })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSentTo(null)}
        >
          {t("password.sendAgain")}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="forgot-email">{t("auth.email")}</FieldLabel>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            required
            autoFocus
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" disabled={isSending}>
          {isSending && <Loader2Icon className="animate-spin" />}
          {t("password.sendLink")}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function SignInPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthMode>("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignUp = mode === "signUp"
  const isForgot = mode === "forgot"

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      if (!isSignUp) {
        // On success the session listener swaps this page for the app.
        await signIn(email, password)
        return
      }
      const { needsConfirmation } = await signUp(email, password)
      if (needsConfirmation) {
        toast.success(t("auth.checkInbox"), {
          description: t("auth.confirmEmail", { email }),
        })
        setMode("signIn")
      }
    } catch (error) {
      toast.error(t(isSignUp ? "auth.signUpError" : "auth.signInError"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSubmitting(false)
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
          <CardTitle>
            {t(
              isForgot
                ? "password.forgotTitle"
                : isSignUp
                  ? "auth.signUpTitle"
                  : "auth.signInTitle"
            )}
          </CardTitle>
          <CardDescription>
            {isForgot ? t("password.forgotDescription") : t("app.tagline")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {hasExpiredLink && mode === "signIn" && (
            <p
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <TriangleAlertIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              {t("password.expiredLink")}
            </p>
          )}
          {isForgot ? (
            <ForgotPasswordForm email={email} onEmailChange={setEmail} />
          ) : (
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="auth-email">
                    {t("auth.email")}
                  </FieldLabel>
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="auth-password">
                      {t("auth.password")}
                    </FieldLabel>
                    {!isSignUp && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-xs"
                        onClick={() => setMode("forgot")}
                      >
                        {t("password.forgot")}
                      </Button>
                    )}
                  </div>
                  <PasswordInput
                    id="auth-password"
                    autoComplete={
                      isSignUp ? "new-password" : "current-password"
                    }
                    minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
                    value={password}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  {isSignUp && (
                    <FieldDescription>
                      {t("auth.passwordHint", { count: MIN_PASSWORD_LENGTH })}
                    </FieldDescription>
                  )}
                </Field>
                <Button type="submit" size="lg" disabled={isSubmitting}>
                  {isSubmitting && <Loader2Icon className="animate-spin" />}
                  {t(isSignUp ? "auth.createAccount" : "auth.signIn")}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm">
          {isForgot ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-1"
              onClick={() => setMode("signIn")}
            >
              {t("password.backToSignIn")}
            </Button>
          ) : (
            <>
              <span className="text-muted-foreground">
                {t(isSignUp ? "auth.haveAccount" : "auth.newHere")}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="px-1"
                onClick={() => setMode(isSignUp ? "signIn" : "signUp")}
              >
                {t(isSignUp ? "auth.signIn" : "auth.createAnAccount")}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </CenteredScreen>
  )
}
