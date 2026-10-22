import { useTranslation } from "react-i18next"

import { PasswordInput } from "@/components/auth/PasswordInput"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { MIN_PASSWORD_LENGTH } from "@/services/authService"
import type { NewPasswordDraft } from "@/utils/password"

interface NewPasswordFieldsProps {
  idPrefix: string
  value: NewPasswordDraft
  onChange: (value: NewPasswordDraft) => void
  disabled?: boolean
}

/** The new password, typed twice. */
export function NewPasswordFields({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: NewPasswordFieldsProps) {
  const { t } = useTranslation()
  // Said once the confirmation is typed in full, not on every key.
  const isMismatch =
    value.confirmation.length >= value.password.length &&
    value.confirmation !== "" &&
    value.confirmation !== value.password

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-new`}>{t("password.new")}</FieldLabel>
        <PasswordInput
          id={`${idPrefix}-new`}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          disabled={disabled}
          value={value.password}
          onChange={(event) =>
            onChange({ ...value, password: event.target.value })
          }
        />
        <FieldDescription>
          {t("auth.passwordHint", { count: MIN_PASSWORD_LENGTH })}
        </FieldDescription>
      </Field>
      <Field data-invalid={isMismatch || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-confirm`}>
          {t("password.confirm")}
        </FieldLabel>
        <PasswordInput
          id={`${idPrefix}-confirm`}
          autoComplete="new-password"
          required
          disabled={disabled}
          aria-invalid={isMismatch || undefined}
          value={value.confirmation}
          onChange={(event) =>
            onChange({ ...value, confirmation: event.target.value })
          }
        />
        {isMismatch && <FieldError>{t("password.mismatch")}</FieldError>}
      </Field>
    </>
  )
}
