import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"

import en from "@/locales/en.json"
import fr from "@/locales/fr.json"

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]["code"]

/** The supported language matching an i18next code, English otherwise. */
export function toLanguage(code: string | undefined): Language {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === code)?.code ?? "en"
  )
}

export const resources = {
  en: { translation: en },
  fr: { translation: fr },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGES.map((language) => language.code),
    // English is the source language of the interface.
    fallbackLng: "en",
    // "fr-FR" from the browser resolves to "fr".
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes rendered values.
      escapeValue: false,
    },
    detection: {
      // A choice made in the language menu wins over the browser language.
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "pointage.language",
    },
  })

// Keeps <html lang> right for screen readers, spell checkers and translators.
i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.resolvedLanguage ?? "en"
