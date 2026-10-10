import "i18next"

import type { resources } from "@/i18n"

// Type-checks every translation key against the English file.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: (typeof resources)["en"]
  }
}
