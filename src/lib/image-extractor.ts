/**
 * Image placeholder extractor.
 *
 * MVP scope: real image extraction (rasterising PDF page regions to PNG +
 * running a vision model to describe them) is a stretch goal. For the MVP we
 * detect "Figure X" captions and references in the text and record the
 * figure label + page number so the chat UI can render a "placeholder box"
 * with a modality badge + page reference. The placeholder text we store as
 * the chunk's `content` is also fed to the embedding model + BM25 so the
 * image chunk is retrievable on queries like "show me Figure 3".
 *
 * The extractor is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

export interface ImagePlaceholder {
  /** 1-indexed page number the figure reference appears on. */
  pageNumber: number
  /** "Figure 1", "Figure 2", ... */
  figureLabel: string
  /** Human-readable placeholder text used as the chunk's content + preview. */
  descriptionPlaceholder: string
}

/**
 * Match "Figure 1", "Figure 12", "Fig. 3", "Fig 3", "fig. 3" — case-insensitive.
 * We capture the integer label.
 */
const FIGURE_RE = /\b(?:figure|fig)\.?\s*([0-9]+)\b/gi

/**
 * Extract image placeholders from text. Each unique "Figure N" mention on the
 * page becomes one ImagePlaceholder. Repeated mentions of the same figure on
 * the same page are deduped (we only emit one placeholder per (page, label)).
 *
 * Pass the page's extracted text + the 1-indexed page number. For a multi-page
 * extraction, call this once per page (see `ingest.ts`).
 */
export function extractImagePlaceholders(
  text: string,
  pageNumber: number = 1,
): ImagePlaceholder[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: ImagePlaceholder[] = []
  let m: RegExpExecArray | null
  // Reset state in case the regex was reused.
  FIGURE_RE.lastIndex = 0
  while ((m = FIGURE_RE.exec(text)) !== null) {
    const labelNum = m[1]
    const figureLabel = `Figure ${labelNum}`
    if (seen.has(figureLabel)) continue
    seen.add(figureLabel)
    out.push({
      pageNumber,
      figureLabel,
      descriptionPlaceholder:
        `[${figureLabel}] — image content not extracted in MVP. ` +
        `Referenced on page ${pageNumber} of the source PDF. ` +
        `Surrounding text: "${surroundingSnippet(text, m.index)}".`,
    })
  }
  return out
}

/** Pull ~80 chars of context around a regex match index for the placeholder preview. */
function surroundingSnippet(text: string, index: number): string {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + 40)
  return text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
}
