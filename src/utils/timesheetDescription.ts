import type { OdooTaskMatch, ParsedCommit } from "@/types/timesheet"

const ELIDING_START = /^[aeiouyhàâäéèêëîïôöùûüœ]/i

/** Endings of French nouns that are nearly always feminine. */
const FEMININE_ENDING =
  /(?:tion|sion|xion|aison|té|ée|ie|ure|ance|ence|ette|ise|ude|esse|ière|ade)$/

/** Feminine nouns frequent in Odoo task titles whose ending doesn't tell. */
const FEMININE_NOUNS = new Set([
  "carte",
  "case",
  "clé",
  "commande",
  "couleur",
  "date",
  "demande",
  "fiche",
  "ligne",
  "liste",
  "note",
  "offre",
  "page",
  "période",
  "recherche",
  "règle",
  "remise",
  "semaine",
  "tâche",
  "taxe",
  "valeur",
  "vente",
  "vue",
  "zone",
])

/** Nouns ending in "s" or "x" that are singular too. */
const INVARIABLE_NOUNS = new Set([
  "cas",
  "choix",
  "corps",
  "devis",
  "mois",
  "poids",
  "prix",
  "processus",
  "temps",
])

/**
 * Adds the French definite article guessed from the first word:
 * "Archivage…" -> "l'Archivage…", "Saisie…" -> "la Saisie…",
 * "Calcul…" -> "le Calcul…", "Codes-barres…" -> "les Codes-barres…".
 * The guess can be wrong; the description stays editable.
 */
function withFrenchArticle(title: string): string {
  if (ELIDING_START.test(title)) {
    return `l'${title}`
  }
  const firstWord = title.split(/[\s'’]/)[0].toLowerCase()
  if (/[sx]$/.test(firstWord) && !INVARIABLE_NOUNS.has(firstWord)) {
    return `les ${title}`
  }
  if (FEMININE_NOUNS.has(firstWord) || FEMININE_ENDING.test(firstWord)) {
    return `la ${title}`
  }
  return `le ${title}`
}

/** "[04-500] Archivage…" or "04-500 - Archivage…" -> "Archivage…" */
function stripTaskReference(taskName: string, taskRef: string | null): string {
  let title = taskName.replace(/^(?:\s*\[[^\]]*\])+\s*/, "")
  if (
    taskRef !== null &&
    title.toLowerCase().startsWith(taskRef.toLowerCase())
  ) {
    title = title.slice(taskRef.length).replace(/^\s*[-–—:]?\s*/, "")
  }
  return title.trim()
}

/**
 * French timesheet description, built from the commit and, once found, its
 * Odoo task: "Ajout de la fonction export dans le module matelec_sale pour
 * l'Archivage produit conditionné". Each part is only added when known.
 */
export function describeCommit(
  commit: ParsedCommit,
  task: OdooTaskMatch | null
): string {
  const title =
    task === null ? "" : stripTaskReference(task.taskName, commit.taskRef)
  if (commit.frenchSummary === "") {
    return title
  }
  const parts = [commit.frenchSummary]
  if (commit.moduleName !== null) {
    parts.push(`dans le module ${commit.moduleName}`)
  }
  if (title !== "") {
    parts.push(`pour ${withFrenchArticle(title)}`)
  }
  return parts.join(" ")
}
