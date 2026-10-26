function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Turns a plain-text note into the HTML of an Odoo chatter message, keeping
 * its layout: blank lines separate paragraphs, line breaks and indentation
 * (the "•" sub-lines of a test note) are kept.
 */
export function noteToHtml(note: string): string {
  return note
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((line) => {
        const indent = /^[ \t]*/.exec(line)?.[0] ?? ""
        const width = indent.replace(/\t/g, "    ").length
        return "&nbsp;".repeat(width) + escapeHtml(line.slice(indent.length))
      })
      return `<p>${lines.join("<br>")}</p>`
    })
    .join("")
}

/** Major version from Odoo's server_version_info: 17, "saas~17"... */
export function readMajorVersion(versionInfo: unknown): number | null {
  if (!Array.isArray(versionInfo)) {
    return null
  }
  const major = /\d+/.exec(String(versionInfo[0]))
  return major === null ? null : Number(major[0])
}
