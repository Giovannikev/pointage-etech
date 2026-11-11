import type { OdooInstanceIndex } from "@/types/timesheet"

/**
 * Longest prompt Claude Desktop takes from a deep link; it cuts longer ones.
 * Kept a little under its own limit (14,336 characters).
 */
export const CLAUDE_PROMPT_MAX_LENGTH = 14_000

/**
 * Deep link opening a new Claude Code session in Claude Desktop, its prompt
 * filled in and, when given, working in a local folder.
 */
export function buildClaudeCodeUrl(prompt: string, folder: string): string {
  const params = new URLSearchParams()
  const text = prompt.trim().slice(0, CLAUDE_PROMPT_MAX_LENGTH)
  if (text !== "") params.set("q", text)
  if (folder.trim() !== "") params.set("folder", folder.trim())
  const query = params.toString()
  return query === "" ? "claude://code/new" : `claude://code/new?${query}`
}

/** Cuts a text to a length, ending it with an ellipsis when cut. */
export function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "TABLE",
  "TR",
])

function appendText(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\s+/g, " "))
    return
  }
  if (!(node instanceof Element)) return
  const tag = node.tagName
  if (tag === "SCRIPT" || tag === "STYLE") return
  if (tag === "BR") {
    out.push("\n")
    return
  }
  if (tag === "LI") out.push("\n- ")
  else if (BLOCK_TAGS.has(tag)) out.push("\n")
  for (const child of node.childNodes) appendText(child, out)
  if (tag === "TD" || tag === "TH") out.push(" | ")
  else if (BLOCK_TAGS.has(tag)) out.push("\n")
}

/**
 * Plain text of an Odoo HTML field (a task description), keeping its lines
 * and list items. The HTML is parsed into an inert document: nothing runs.
 */
export function htmlToPlainText(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body
  const out: string[] = []
  appendText(body, out)
  return out
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/* ---- Local folder of each project ---------------------------------- */

const FOLDERS_KEY = "pointage.claudeFolders"

/** A project, as the folders are remembered by. */
export interface ProjectRef {
  instanceIndex: OdooInstanceIndex
  projectId: number | null
}

function folderKey({ instanceIndex, projectId }: ProjectRef): string {
  return `${instanceIndex}:${projectId ?? "none"}`
}

function readFolders(): Record<string, string> {
  try {
    const stored = localStorage.getItem(FOLDERS_KEY)
    const parsed: unknown = stored === null ? {} : JSON.parse(stored)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * The local folder (repository) last used with Claude for a project. Kept
 * in this browser only: the path depends on the computer.
 */
export function readProjectFolder(project: ProjectRef): string {
  const folder = readFolders()[folderKey(project)]
  return typeof folder === "string" ? folder : ""
}

export function saveProjectFolder(project: ProjectRef, folder: string): void {
  try {
    const folders = readFolders()
    const key = folderKey(project)
    if (folder.trim() === "") delete folders[key]
    else folders[key] = folder.trim()
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
  } catch {
    // Storage blocked: the folder is just not remembered.
  }
}
