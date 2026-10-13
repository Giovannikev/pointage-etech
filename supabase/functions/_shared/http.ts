import { requireUserId } from "./auth.ts"
import { readEnv } from "./env.ts"
import { HttpError } from "./errors.ts"

type HttpMethod = "GET" | "POST" | "PUT"

interface HandlerContext {
  request: Request
  userId: string
}

type Handler = (context: HandlerContext) => Promise<unknown>

/**
 * Sites allowed to read the responses, from the ALLOWED_ORIGIN secret: a
 * comma-separated list such as
 * "https://pointage.example.com,http://localhost:5173". Unset or "*" allows
 * every site (the session token still protects every call).
 */
export function parseAllowedOrigins(value: string | null): string[] | null {
  if (value === null) {
    return null
  }
  const origins = value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin !== "")
  return origins.length === 0 || origins.includes("*") ? null : origins
}

/**
 * The Access-Control-Allow-Origin value for a request: the caller's origin
 * when it is in the list. Otherwise the first allowed origin, which doesn't
 * match the caller, so the browser blocks the response.
 */
export function resolveAllowedOrigin(
  allowed: string[] | null,
  requestOrigin: string | null
): string {
  if (allowed === null) {
    return "*"
  }
  return requestOrigin !== null && allowed.includes(requestOrigin)
    ? requestOrigin
    : allowed[0]
}

function corsHeaders(
  request: Request,
  allowedMethods: string
): Record<string, string> {
  const allowed = parseAllowedOrigins(readEnv("ALLOWED_ORIGIN"))
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": resolveAllowedOrigin(
      allowed,
      request.headers.get("Origin")
    ),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": allowedMethods,
  }
  if (allowed !== null) {
    // The answer depends on the caller: caches must not share it across sites.
    headers.Vary = "Origin"
  }
  return headers
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new HttpError("Request body must be valid JSON.", 400)
  }
}

/**
 * Serves an authenticated JSON endpoint: CORS, signed-in user check, routing
 * by HTTP method and mapping of errors to JSON responses.
 */
export function serveJson(
  functionName: string,
  handlers: Partial<Record<HttpMethod, Handler>>
): void {
  const methods = Object.keys(handlers) as HttpMethod[]
  const allowedMethods = ["OPTIONS", ...methods].join(", ")

  Deno.serve(async (request) => {
    const headers = corsHeaders(request, allowedMethods)
    const jsonResponse = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      })

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers })
    }
    const handler = methods.includes(request.method as HttpMethod)
      ? handlers[request.method as HttpMethod]
      : undefined
    if (handler === undefined) {
      return jsonResponse(
        { error: `Method not allowed. Use ${methods.join(" or ")}.` },
        405
      )
    }

    try {
      const userId = await requireUserId(request)
      return jsonResponse(await handler({ request, userId }))
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status)
      }
      console.error(`${functionName}: unexpected error`, error)
      return jsonResponse({ error: "Unexpected server error." }, 500)
    }
  })
}
