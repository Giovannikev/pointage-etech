import { useState, type FormEvent } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import { signIn, signUp } from "@/services/authService"

const MIN_PASSWORD_LENGTH = 8

type AuthMode = "signIn" | "signUp"

export function SignInPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthMode>("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignUp = mode === "signUp"

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
            {t(isSignUp ? "auth.signUpTitle" : "auth.signInTitle")}
          </CardTitle>
          <CardDescription>{t("app.tagline")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="auth-email">{t("auth.email")}</FieldLabel>
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
                <FieldLabel htmlFor="auth-password">
                  {t("auth.password")}
                </FieldLabel>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
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
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm">
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
        </CardFooter>
      </Card>
    </CenteredScreen>
  )
}
