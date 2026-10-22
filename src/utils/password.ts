import { MIN_PASSWORD_LENGTH } from "@/services/authService"

export interface NewPasswordDraft {
  password: string
  confirmation: string
}

export const EMPTY_NEW_PASSWORD: NewPasswordDraft = {
  password: "",
  confirmation: "",
}

/** Why the new password can't be used yet; null when it can. */
export function newPasswordProblem(
  draft: NewPasswordDraft
): "tooShort" | "mismatch" | null {
  if (draft.password.length < MIN_PASSWORD_LENGTH) return "tooShort"
  if (draft.password !== draft.confirmation) return "mismatch"
  return null
}
