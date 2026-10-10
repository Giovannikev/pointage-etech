import { createElement, Fragment, useMemo, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Renders an Odoo HTML field (task description, notes) safely.
 *
 * The HTML is parsed by the browser into an inert document (DOMParser runs no
 * script and loads nothing), then rebuilt as React elements from an allowlist
 * of tags. Attributes are dropped, except safe link targets and table spans,
 * so no Odoo markup or inline style ever reaches the page as raw HTML.
 */

const KEPT_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
])

/** Removed with their content; every other unknown tag is unwrapped. */
const DROPPED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "img",
  "svg",
  "video",
  "audio",
  "form",
  "input",
  "button",
  "select",
  "textarea",
])

/** React rejects whitespace text directly inside these elements. */
const NO_TEXT_CHILDREN = new Set(["table", "thead", "tbody", "tr", "ul", "ol"])

const VOID_TAGS = new Set(["br", "hr"])

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

function safeHref(href: string | null): string | null {
  if (href === null) {
    return null
  }
  try {
    const url = new URL(href, window.location.origin)
    return SAFE_URL_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function readSpan(element: Element, name: string): number | undefined {
  const span = Number(element.getAttribute(name))
  return Number.isInteger(span) && span > 1 && span <= 100 ? span : undefined
}

function renderChildren(element: Element, key: string): ReactNode[] {
  const skipBlankText = NO_TEXT_CHILDREN.has(element.tagName.toLowerCase())
  return Array.from(element.childNodes).flatMap((child, index) => {
    if (
      skipBlankText &&
      child.nodeType === Node.TEXT_NODE &&
      child.textContent?.trim() === ""
    ) {
      return []
    }
    return [renderNode(child, `${key}.${index}`)]
  })
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent
  }
  if (!(node instanceof Element)) {
    return null
  }

  const tag = node.tagName.toLowerCase()
  if (DROPPED_TAGS.has(tag)) {
    return null
  }
  // Odoo's empty editor paragraphs ("<p><br></p>") only add blank space.
  if ((tag === "p" || tag === "div") && node.textContent?.trim() === "") {
    return null
  }
  if (VOID_TAGS.has(tag)) {
    return createElement(tag, { key })
  }

  const children = renderChildren(node, key)

  if (tag === "a") {
    const href = safeHref(node.getAttribute("href"))
    return href === null ? (
      <Fragment key={key}>{children}</Fragment>
    ) : (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  if (tag === "table") {
    return (
      <div key={key} className="overflow-x-auto">
        <table>{children}</table>
      </div>
    )
  }
  if (tag === "td" || tag === "th") {
    return createElement(
      tag,
      {
        key,
        colSpan: readSpan(node, "colspan"),
        rowSpan: readSpan(node, "rowspan"),
      },
      children
    )
  }
  if (KEPT_TAGS.has(tag)) {
    return createElement(tag, { key }, children)
  }
  // div, span, font… keep the content, drop the wrapper.
  return tag === "div" ? (
    <div key={key}>{children}</div>
  ) : (
    <Fragment key={key}>{children}</Fragment>
  )
}

/** Typography for the rebuilt elements; the project has no prose plugin. */
const RICH_TEXT_STYLES = [
  "text-sm leading-relaxed break-words",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-2 [&_div]:my-1",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:font-semibold",
  "[&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:font-medium [&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:font-medium",
  "[&_strong]:font-semibold [&_b]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li>p]:my-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:bg-muted [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td>p]:my-0",
  "[&_th]:bg-muted/50 [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
  // First column of key/value tables (Critère, Étant donné, Quand, Alors).
  "[&_td:first-child]:text-muted-foreground [&_td:first-child]:font-medium",
].join(" ")

interface OdooRichTextProps {
  html: string
  className?: string
  /** Shown when the field is empty or holds only blank paragraphs. */
  emptyText: string
}

export function OdooRichText({
  html,
  className,
  emptyText,
}: OdooRichTextProps) {
  const content = useMemo(() => {
    const body = new DOMParser().parseFromString(html, "text/html").body
    return body.textContent?.trim() === "" ? null : renderChildren(body, "root")
  }, [html])

  if (content === null) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  return <div className={cn(RICH_TEXT_STYLES, className)}>{content}</div>
}
