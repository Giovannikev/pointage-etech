import { describe, expect, it } from "vitest"

import { readAuthRedirect } from "@/services/authService"
import { newPasswordProblem } from "@/utils/password"

describe("newPasswordProblem", () => {
  it("needs 8 characters typed twice", () => {
    expect(
      newPasswordProblem({ password: "short", confirmation: "short" })
    ).toBe("tooShort")
    expect(
      newPasswordProblem({ password: "longenough", confirmation: "longenougH" })
    ).toBe("mismatch")
    expect(
      newPasswordProblem({ password: "longenough", confirmation: "longenough" })
    ).toBeNull()
  })
})

describe("readAuthRedirect", () => {
  it("tells a password reset link", () => {
    expect(
      readAuthRedirect(
        "#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery",
        ""
      )
    ).toEqual({ kind: "recovery" })
  })

  it("tells an expired link, from the hash or the query", () => {
    expect(
      readAuthRedirect(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
        ""
      )
    ).toEqual({
      kind: "error",
      message: "Email link is invalid or has expired",
    })
    expect(
      readAuthRedirect("", "?error=access_denied&error_description=Expired")
    ).toEqual({ kind: "error", message: "Expired" })
  })

  it("ignores the app's own hashes and sign-up links", () => {
    expect(readAuthRedirect("#kanban?group=project", "")).toBeNull()
    expect(readAuthRedirect("#access_token=abc&type=signup", "")).toBeNull()
  })
})
