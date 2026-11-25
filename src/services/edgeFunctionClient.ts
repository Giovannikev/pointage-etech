import {
  FunctionsHttpError,
  type FunctionInvokeOptions,
} from "@supabase/supabase-js"
import i18n from "i18next"

import { getSupabaseClient } from "@/services/supabaseClient"
import { isNonEmptyString, isRecord } from "@/utils/guards"

export class InvalidResponseError extends Error {
  constructor(functionName: string) {
    super(i18n.t("errors.unexpectedResponse", { name: functionName }))
    this.name = "InvalidResponseError"
  }
}

interface InvokeOptions {
  method?: "GET" | "POST" | "PUT"
  body?: FunctionInvokeOptions["body"]
}

async function describeInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const response: unknown = error.context
    if (response instanceof Response) {
      try {
        const body: unknown = await response.json()
        if (isRecord(body) && isNonEmptyString(body.error)) {
          return body.error
        }
      } catch {
        // The body was not JSON; fall back to the generic message below.
      }
    }
  }
  // No HTTP answer at all (offline, DNS, CORS): supabase-js says so in
  // English, so it is replaced by a translated message.
  return i18n.t("errors.network")
}

/** Calls an Edge Function as the signed-in user and returns its JSON body. */
export async function invokeFunction(
  functionName: string,
  { method = "POST", body }: InvokeOptions = {}
): Promise<unknown> {
  const { data, error } = await getSupabaseClient().functions.invoke<unknown>(
    functionName,
    { method, body }
  )
  if (error !== null) {
    throw new Error(await describeInvokeError(error))
  }
  return data
}
