import { deepStrictEqual as assertEquals } from "node:assert"

import { parseAllowedOrigins, resolveAllowedOrigin } from "./http.ts"

Deno.test("an unset or wildcard secret allows every site", () => {
  assertEquals(parseAllowedOrigins(null), null)
  assertEquals(parseAllowedOrigins("*"), null)
  assertEquals(parseAllowedOrigins(" , "), null)
  assertEquals(resolveAllowedOrigin(null, "https://any.site"), "*")
})

Deno.test(
  "the secret is a comma-separated list, trailing slashes ignored",
  () => {
    assertEquals(
      parseAllowedOrigins("https://app.example.com/, http://localhost:5173"),
      ["https://app.example.com", "http://localhost:5173"]
    )
  }
)

Deno.test("a listed caller gets its own origin back", () => {
  const allowed = ["https://app.example.com", "http://localhost:5173"]
  assertEquals(
    resolveAllowedOrigin(allowed, "http://localhost:5173"),
    "http://localhost:5173"
  )
})

Deno.test("an unlisted caller gets an origin that doesn't match it", () => {
  const allowed = ["https://app.example.com"]
  assertEquals(
    resolveAllowedOrigin(allowed, "https://evil.example"),
    "https://app.example.com"
  )
  assertEquals(resolveAllowedOrigin(allowed, null), "https://app.example.com")
})
