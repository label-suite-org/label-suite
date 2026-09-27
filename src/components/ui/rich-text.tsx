import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Renders reviewed rich text as React elements.
 *
 * The HTML string is parsed with DOMParser and rebuilt through an allowlist of
 * tags and attributes, so untrusted markup can never reach the DOM as HTML
 * (anything unrecognized degrades to plain text). Parsing happens on the
 * client; until hydration the container renders empty.
 */
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "a", "span",
  "ul", "ol", "li", "blockquote", "h2", "h3", "code", "pre", "div",
])

function isSafeHref(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value)
}

function convertNode(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  const children = Array.from(element.childNodes).map((child, index) => convertNode(child, `${key}-${index}`))

  if (!ALLOWED_TAGS.has(tag)) return <React.Fragment key={key}>{children}</React.Fragment>

  const attributes: Record<string, unknown> = { key }
  if (tag === "a") {
    const href = element.getAttribute("href")
    if (href && isSafeHref(href)) {
      attributes.href = href
      attributes.rel = "noopener noreferrer"
    }
  }

  return React.createElement(tag, attributes, children)
}

function RichText({ html, className, ...props }: React.ComponentProps<"div"> & { html: string }) {
  const content = React.useMemo(() => {
    if (typeof window === "undefined" || typeof DOMParser === "undefined") return null
    const parsed = new DOMParser().parseFromString(html, "text/html")
    return Array.from(parsed.body.childNodes).map((child, index) => convertNode(child, `rich-text-${index}`))
  }, [html])

  return (
    <div
      data-slot="rich-text"
      className={cn(className)}
      {...props}
    >
      {content}
    </div>
  )
}

export { RichText }
