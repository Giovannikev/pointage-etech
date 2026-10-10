import type { CommitAction, ParsedCommit } from "@/types/timesheet"
import { FRENCH_CONNECTORS, FRENCH_GLOSSARY } from "@/utils/frenchGlossary"

const FRENCH_ACTION_PREFIXES: Readonly<Record<CommitAction, string>> = {
  add: "Ajout de la fonction",
  fix: "Correction du problème",
  update: "Mise à jour de",
  refactor: "Refactorisation de",
  remove: "Suppression de",
}

const VERB_ACTIONS: Readonly<Record<string, CommitAction>> = {
  add: "add",
  added: "add",
  adds: "add",
  adding: "add",
  fix: "fix",
  fixed: "fix",
  fixes: "fix",
  fixing: "fix",
  update: "update",
  updated: "update",
  updates: "update",
  updating: "update",
  refactor: "refactor",
  refactored: "refactor",
  refactors: "refactor",
  refactoring: "refactor",
  remove: "remove",
  removed: "remove",
  removes: "remove",
  removing: "remove",
  delete: "remove",
  deleted: "remove",
  deletes: "remove",
  deleting: "remove",
}

/** Odoo commit tags ([ADD], [FIX], [IMP]...). Tags without a mapped action are still recognized. */
const ODOO_TAG_ACTIONS: Readonly<Record<string, CommitAction | null>> = {
  add: "add",
  fix: "fix",
  imp: "update",
  i18n: "update",
  ref: "refactor",
  rem: "remove",
  rev: null,
  mov: null,
  merge: null,
  cla: null,
  perf: null,
}

/** Conventional Commits types. Types without a mapped action are still recognized. */
const CONVENTIONAL_TYPE_ACTIONS: Readonly<Record<string, CommitAction | null>> =
  {
    feat: "add",
    fix: "fix",
    refactor: "refactor",
    perf: null,
    docs: null,
    style: null,
    test: null,
    chore: null,
    build: null,
    ci: null,
    revert: null,
  }

const MERGE_COMMIT =
  /^Merge (?:branch|pull request|remote-tracking branch|tag)\b/i
const LIST_BULLET = /^(?:[-*•]|\d+[.)])\s+/
const COMMIT_HASH_PREFIX = /^(?=[0-9a-f]*\d)[0-9a-f]{7,40}\s+/i
const LEADING_BRACKET = /^\[([^\]]*)\]\s*/
const TRAILING_BRACKET = /\s*\[([^\]]*)\]$/
const BARE_TASK_REF =
  /^(#\d+|(?:[A-Za-z]+-)?\d+(?:-\d+)+|[A-Za-z]+-\d+)(?=[\s:]|$)\s*:?\s*/
const TASK_REF_SHAPE = /^#?[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*$/
const CONVENTIONAL_PREFIX = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*/i
const MODULE_NAME = /^[a-z][a-z0-9_]*$/
const MODULE_PREFIX = /^([a-z][a-z0-9_]*)\s*:\s*/
const GIT_LOG_HEADER = /^commit [0-9a-f]{7,40}\b.*$/m
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i
const TECHNICAL_IDENTIFIER = /^(?:`[^`]+`|\w+(?:[./-]\w+)*)$/
const TRAILING_PUNCTUATION = /[\s.;,:]+$/
const FRENCH_ELISION_TARGET = /^[aeiouyhàâäéèêëîïôöùûü]/i

type BracketToken =
  | { kind: "tag"; action: CommitAction | null }
  | { kind: "taskRef"; value: string }
  | { kind: "module"; value: string }

/** Own-property lookup, so keys such as "constructor" never hit the prototype. */
function lookup<T>(
  record: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isTaskRef(token: string): boolean {
  return TASK_REF_SHAPE.test(token) && /\d/.test(token)
}

function normalizeTaskRef(token: string): string {
  return token.replace(/^#/, "")
}

function isTechnicalIdentifier(word: string): boolean {
  return TECHNICAL_IDENTIFIER.test(word) && /[`_./]/.test(word)
}

function classifyBracketToken(token: string): BracketToken | null {
  const lowered = token.toLowerCase()
  const tagAction = lookup(ODOO_TAG_ACTIONS, lowered)
  if (tagAction !== undefined) {
    return { kind: "tag", action: tagAction }
  }
  if (isTaskRef(token)) {
    return { kind: "taskRef", value: normalizeTaskRef(token) }
  }
  if (MODULE_NAME.test(token)) {
    return { kind: "module", value: token }
  }
  return null
}

/** Joins two French fragments, eliding "de" before a vowel ("de état" -> "d'état"). */
function joinFrench(left: string, right: string): string {
  if (/\bde$/.test(left) && FRENCH_ELISION_TARGET.test(right)) {
    return `${left.slice(0, -2)}d'${right}`
  }
  return `${left} ${right}`
}

function translateSegment(segment: string): string | null {
  const cleaned = segment.replace(LEADING_ARTICLE, "")
  const direct = lookup(FRENCH_GLOSSARY, cleaned.toLowerCase())
  if (direct !== undefined) {
    return direct
  }

  const words = cleaned.split(" ")
  if (words.length === 1) {
    return isTechnicalIdentifier(cleaned) ? cleaned : null
  }

  // "field x_ref" -> "champ x_ref"
  const last = words[words.length - 1]
  const head = lookup(
    FRENCH_GLOSSARY,
    words.slice(0, -1).join(" ").toLowerCase()
  )
  if (head !== undefined && isTechnicalIdentifier(last)) {
    return `${head} ${last}`
  }

  // "x_ref field" -> "champ x_ref"
  const first = words[0]
  const tail = lookup(FRENCH_GLOSSARY, words.slice(1).join(" ").toLowerCase())
  if (tail !== undefined && isTechnicalIdentifier(first)) {
    return `${tail} ${first}`
  }

  return null
}

/**
 * Translates a commit object to French using the glossary. The text is split
 * on connector words; if any segment is unknown the original text is returned
 * untouched rather than producing a half-translated sentence.
 */
export function translateToFrench(text: string): string {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean)
  if (words.length === 0) {
    return ""
  }

  const segments: string[][] = [[]]
  const connectors: string[] = []
  for (const word of words) {
    const connector = lookup(FRENCH_CONNECTORS, word.toLowerCase())
    const current = segments[segments.length - 1]
    if (connector !== undefined && current.length > 0) {
      connectors.push(connector)
      segments.push([])
    } else {
      current.push(word)
    }
  }

  const translated = segments.map((segment) =>
    segment.length > 0 ? translateSegment(segment.join(" ")) : null
  )
  if (translated.some((segment) => segment === null)) {
    return words.join(" ")
  }

  const [firstSegment, ...otherSegments] = translated as string[]
  return otherSegments.reduce(
    (sentence, segment, index) =>
      joinFrench(`${sentence} ${connectors[index]}`, segment),
    firstSegment
  )
}

/** French action followed by the translated object, e.g. "Ajout de la fonction export". */
function formatFrenchSummary(
  action: CommitAction | null,
  object: string
): string {
  const translatedObject = translateToFrench(object)

  if (action === null) {
    return capitalize(translatedObject)
  }
  const prefix = FRENCH_ACTION_PREFIXES[action]
  return translatedObject === "" ? prefix : joinFrench(prefix, translatedObject)
}

function firstNonEmptyLine(message: string): string {
  const line = message
    .split(/\r?\n/)
    .find((candidate) => candidate.trim() !== "")
  return line === undefined ? "" : normalizeWhitespace(line)
}

/**
 * Parses a single commit message. Only the subject line is used.
 * Returns null for empty input and merge commits.
 *
 * Supported shapes include:
 * - `[03-500] matelec_sale: add french translations`
 * - `03-500 matelec_sale: fix rounding`
 * - `[FIX] matelec_sale: rounding issue [03-500]` (Odoo commit tags)
 * - `[03-500] feat(matelec_sale): add export` (Conventional Commits)
 * - `a1b2c3d [03-500] add export` (git log --oneline)
 */
export function parseCommitMessage(message: string): ParsedCommit | null {
  const rawMessage = firstNonEmptyLine(message)
  if (rawMessage === "" || MERGE_COMMIT.test(rawMessage)) {
    return null
  }

  let rest = rawMessage.replace(LIST_BULLET, "").replace(COMMIT_HASH_PREFIX, "")
  let taskRef: string | null = null
  let moduleName: string | null = null
  let fallbackAction: CommitAction | null = null

  for (
    let bracket = LEADING_BRACKET.exec(rest);
    bracket !== null;
    bracket = LEADING_BRACKET.exec(rest)
  ) {
    const token = classifyBracketToken(bracket[1].trim())
    if (token === null) {
      break
    }
    if (token.kind === "tag") {
      fallbackAction ??= token.action
    } else if (token.kind === "taskRef") {
      taskRef ??= token.value
    } else {
      moduleName ??= token.value
    }
    rest = rest.slice(bracket[0].length)
  }

  if (taskRef === null) {
    const bareRef = BARE_TASK_REF.exec(rest)
    if (bareRef !== null) {
      taskRef = normalizeTaskRef(bareRef[1])
      rest = rest.slice(bareRef[0].length)
    }
  }

  if (taskRef === null) {
    const trailing = TRAILING_BRACKET.exec(rest)
    if (trailing !== null && isTaskRef(trailing[1].trim())) {
      taskRef = normalizeTaskRef(trailing[1].trim())
      rest = rest.slice(0, trailing.index)
    }
  }

  const conventional = CONVENTIONAL_PREFIX.exec(rest)
  const conventionalAction =
    conventional === null
      ? undefined
      : lookup(CONVENTIONAL_TYPE_ACTIONS, conventional[1].toLowerCase())
  if (conventional !== null && conventionalAction !== undefined) {
    fallbackAction ??= conventionalAction
    const scope = conventional[2]?.trim() ?? ""
    if (MODULE_NAME.test(scope)) {
      moduleName ??= scope
    }
    rest = rest.slice(conventional[0].length)
  }

  const modulePrefix = MODULE_PREFIX.exec(rest)
  if (modulePrefix !== null) {
    const isVerb = lookup(VERB_ACTIONS, modulePrefix[1]) !== undefined
    if (isVerb) {
      // "add: french translations" -> verb followed by a stray colon
      rest = `${modulePrefix[1]} ${rest.slice(modulePrefix[0].length)}`
    } else if (moduleName === null) {
      moduleName = modulePrefix[1]
      rest = rest.slice(modulePrefix[0].length)
    }
  }

  const rawDescription = rest.replace(TRAILING_PUNCTUATION, "").trim()
  const [firstWord = "", ...otherWords] = rawDescription.split(" ")
  const verbAction = lookup(VERB_ACTIONS, firstWord.toLowerCase())

  const action = verbAction ?? fallbackAction
  const object =
    verbAction === undefined ? rawDescription : otherWords.join(" ")

  return {
    rawMessage,
    taskRef,
    moduleName,
    action,
    rawDescription,
    frenchSummary: formatFrenchSummary(action, object),
  }
}

/**
 * Splits pasted text into commit subjects. Handles one commit per line
 * (`git log --oneline`, plain lists) and the default `git log` format.
 */
export function splitCommitMessages(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, "\n")

  if (!GIT_LOG_HEADER.test(text)) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
  }

  return text
    .split(GIT_LOG_HEADER)
    .slice(1)
    .map((block) => block.split("\n").find((line) => /^\s+\S/.test(line)))
    .filter((subject): subject is string => subject !== undefined)
    .map((subject) => subject.trim())
}

/** Parses pasted commits, skipping merge commits and duplicates. */
export function parseCommitLog(raw: string): ParsedCommit[] {
  const seen = new Set<string>()
  const commits: ParsedCommit[] = []

  for (const message of splitCommitMessages(raw)) {
    const parsed = parseCommitMessage(message)
    if (parsed !== null && !seen.has(parsed.rawMessage)) {
      seen.add(parsed.rawMessage)
      commits.push(parsed)
    }
  }
  return commits
}
