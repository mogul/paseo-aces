/**
 * Text rendering fallback (A2UI v1.0 Basic Catalog Guide, Text): render
 * Markdown when possible; without a Markdown dependency, conservatively strip
 * the common markers so the text stays legible. One anchored regex pass per
 * marker over the single resolved string — no block-level parsing. When a
 * construct is ambiguous (e.g. `2*3*4` or `snake_case`), it is left alone.
 */
export function stripMarkdownMarkers(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1") // [text](url) → text
    .replace(/`([^`]*)`/g, "$1") // `code` → code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]*[^\s*])\*(?!\w)/g, "$1$2") // *italic*
    .replace(/(^|[^\w_])_(?!\s)([^_\n]*[^\s_])_(?!\w)/g, "$1$2") // _italic_
    .replace(/^#{1,6}[ \t]+/gm, ""); // leading "# " headings
}
