/**
 * Citation parsing + formatting helpers for the multimodal chat UI.
 *
 * The assistant emits inline `[^c1]` markers per the system prompt; this
 * module parses those markers back into structured `CitationCard` shapes
 * that the UI can render with a modality badge (TEXT / IMAGE / TABLE),
 * page number, and a preview (truncated text body, image placeholder, or
 * rendered HTML table).
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

import type { Modality } from './chunker-multimodal'

export interface CitationSource {
  /** Chunk ID from the DB. */
  chunkId: string
  /** Document ID the chunk belongs to. */
  documentId: string
  /** Document filename (for display). */
  filename: string
  modality: Modality
  pageNumber: number
  heading: string | null
  content: string
}

export interface CitationCard {
  /** Short id used inside the message body, e.g. "c1". */
  shortId: string
  chunkId: string
  documentId: string
  filename: string
  modality: Modality
  pageNumber: number
  heading: string | null
  /** UI-friendly preview string (always plain text). */
  preview: string
  /** True when the preview was truncated. */
  truncated: boolean
}

/**
 * Parse `[^c1]` markers out of an assistant message. Returns an ordered list
 * of unique short ids ("c1", "c2", ...) in the order they first appear.
 */
export function parseCitations(message: string): string[] {
  if (!message) return []
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\[\^(c\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

/**
 * Resolve short ids ("c1") to chunk IDs via the citation map. The citation map
 * is keyed by chunkId -> { shortId: 'c1', ...source }, as produced by the
 * retrieval pipeline.
 */
export function resolveCitationSources(
  shortIds: string[],
  citationMap: Record<string, { shortId: string; source: CitationSource }>,
): CitationSource[] {
  const byShort = new Map<string, CitationSource>()
  for (const v of Object.values(citationMap)) {
    byShort.set(v.shortId, v.source)
  }
  const out: CitationSource[] = []
  for (const sid of shortIds) {
    const src = byShort.get(sid)
    if (src) out.push(src)
  }
  return out
}

const PREVIEW_MAX_CHARS = 180

/**
 * Build a UI-friendly citation card from a source. The preview is a plain
 * string (the UI is responsible for choosing how to render it given the
 * modality — e.g. for `table` modality the UI can re-render the markdown
 * as an HTML table).
 */
export function formatCitationCard(source: CitationSource, shortId: string): CitationCard {
  const raw = source.content ?? ''
  let preview = raw.replace(/\s+/g, ' ').trim()
  let truncated = false
  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS)
    truncated = true
  }
  return {
    shortId,
    chunkId: source.chunkId,
    documentId: source.documentId,
    filename: source.filename,
    modality: source.modality,
    pageNumber: source.pageNumber,
    heading: source.heading,
    preview,
    truncated,
  }
}

/**
 * Build citation cards for every cited source in an assistant message.
 * Returns an ordered list (the order the markers first appeared in the
 * message, deduped).
 */
export function buildCitationCards(
  message: string,
  citationMap: Record<string, { shortId: string; source: CitationSource }>,
): CitationCard[] {
  const shortIds = parseCitations(message)
  const sources = resolveCitationSources(shortIds, citationMap)
  return sources.map((s) => formatCitationCard(s, shortIds.find((sid) => {
    const v = Object.values(citationMap).find((vv) => vv.source.chunkId === s.chunkId)
    return v?.shortId === sid
  })!))
}

/**
 * Human-readable badge label for a modality. Used by the UI badge + the
 * page-view.
 */
export function modalityBadgeLabel(modality: Modality): 'TEXT' | 'IMAGE' | 'TABLE' {
  switch (modality) {
    case 'text':
      return 'TEXT'
    case 'image':
      return 'IMAGE'
    case 'table':
      return 'TABLE'
  }
}

/**
 * Tailwind class string for the modality badge. The colour choices avoid
 * indigo/blue per the project styling rules — TEXT is neutral, IMAGE is
 * amber, TABLE is emerald.
 */
export function modalityBadgeClass(modality: Modality): string {
  switch (modality) {
    case 'text':
      return 'bg-secondary text-secondary-foreground border-border'
    case 'image':
      return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800'
    case 'table':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800'
  }
}
