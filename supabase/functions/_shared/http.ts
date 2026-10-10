import { requireUserId } from "./auth.ts"
import { readEnv } from "./env.ts"
import { HttpError } from "./errors.ts"

type HttpMethod = "GET" | "POST" | "PUT"

interface HandlerContext {
  request: Request
  userId: string
}

type Handler = (context: HandlerContext) => Promise<unknown>

function corsHeaders(allowedMethods: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": readEnv("ALLOWED_ORIGIN") ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": allowedMethods,
  }
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
  const headers = corsHeaders(["OPTIONS", ...methods].join(", "))

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    })

  Deno.serve(async (request) => {
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
