/**
 * Multimodal chunker.
 *
 * Given a single PDF page's extracted text, image placeholders, and detected
 * tables, produce `DocumentChunk` rows with the correct `modality`, `heading`,
 * `content`, `pageNumber`, and `ordinal` — ready to embed and persist into
 * the `DocumentChunk` table.
 *
 * Ordering rule:
 *   text chunks -> table chunks -> image chunks
 * (text first because it's the bulk of the page; tables next because they
 * usually appear right after the prose that introduces them; images last
 * because their placeholder text is short and mostly acts as a "see Figure X
 * on page N" pointer).
 *
 * The ordinal is assigned by the orchestrator across the WHOLE document, not
 * per-page. This module accepts a `startOrdinal` so a multi-page ingest can
 * thread the counter through every page.
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

import type { ImagePlaceholder } from './image-extractor'
import type { DetectedTable } from './table-detector'
import { splitBodyByTokens } from './chunker'

export type Modality = 'text' | 'image' | 'table'

export interface MultimodalChunkData {
  /** 1-indexed position within the document. Assigned by the orchestrator. */
  ordinal: number
  /** 'text' | 'image' | 'table' */
  modality: Modality
  /** 1-indexed page number. */
  pageNumber: number
  /** Heading shown in the UI citation card. */
  heading: string | null
  /** Text body for text modality; placeholder description for image; markdown for table. */
  content: string
  /** Bounding box of the chunk in PDF coordinates. null for MVP. */
  bbox: string | null
}

export interface PageInputs {
  pageNumber: number
  text: string
  images: ImagePlaceholder[]
  tables: DetectedTable[]
}

export interface ChunkOptions {
  targetTokens?: number
  overlapTokens?: number
}

/**
 * Build chunks for a single page. The `startOrdinal` is the next free ordinal
 * for this document; the returned chunks use ordinals startOrdinal..N, and the
 * caller passes the new startOrdinal (returned as `nextOrdinal`) to the next
 * page.
 */
export function chunkPage(
  page: PageInputs,
  startOrdinal: number,
  opts: ChunkOptions = {},
): { chunks: MultimodalChunkData[]; nextOrdinal: number } {
  const targetTokens = opts.targetTokens ?? 256
  const overlapTokens = opts.overlapTokens ?? 48
  const chunks: MultimodalChunkData[] = []
  let ordinal = startOrdinal

  // 1. TEXT chunks — split the page's body text by tokens. Skip empty pages.
  if (page.text.trim()) {
    const bodies = splitBodyByTokens(page.text, targetTokens, overlapTokens)
    for (const body of bodies) {
      if (!body.trim()) continue
      chunks.push({
        ordinal: ordinal++,
        modality: 'text',
        pageNumber: page.pageNumber,
        heading: `Page ${page.pageNumber}`,
        content: body,
        bbox: null,
      })
    }
  }

  // 2. TABLE chunks — one per detected table. content = markdown rendering.
  for (const t of page.tables) {
    chunks.push({
      ordinal: ordinal++,
      modality: 'table',
      pageNumber: t.pageNumber,
      heading: t.label,
      content: t.markdown,
      bbox: null,
    })
  }

  // 3. IMAGE chunks — one per figure placeholder. content = placeholder description.
  for (const img of page.images) {
    chunks.push({
      ordinal: ordinal++,
      modality: 'image',
      pageNumber: img.pageNumber,
      heading: img.figureLabel,
      content: img.descriptionPlaceholder,
      bbox: null,
    })
  }

  return { chunks, nextOrdinal: ordinal }
}

/**
 * Convenience: build chunks for an entire document (all pages). The ordinal is
 * threaded across pages so the final chunk list has 1..N ordinals.
 */
export function chunkDocument(
  pages: PageInputs[],
  opts: ChunkOptions = {},
): MultimodalChunkData[] {
  let startOrdinal = 1
  const out: MultimodalChunkData[] = []
  for (const page of pages) {
    const { chunks, nextOrdinal } = chunkPage(page, startOrdinal, opts)
    out.push(...chunks)
    startOrdinal = nextOrdinal
  }
  return out
}
