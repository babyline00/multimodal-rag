/**
 * Multimodal PDF ingest pipeline.
 *
 * End-to-end: PDF bytes -> per-page text via pdfjs-dist -> per-page image
 * placeholders + detected tables -> multimodal chunk list -> embed each
 * chunk -> persist into `Document` + `DocumentChunk`.
 *
 * Each step is a pure-ish function that has its own unit tests; this module
 * is the seam that wires them together with the embedding provider and the
 * database. It is intentionally NOT unit-tested (it touches the DB) — the
 * testable behaviour lives in the per-modality extractors + chunker.
 */

import { extractText } from './text-extractor'
import { extractImagePlaceholders } from './image-extractor'
import { detectTables } from './table-detector'
import { chunkDocument, type PageInputs } from './chunker-multimodal'
import { tokenize } from './tokenizer'
import { getEmbeddingProvider, serializeVector } from './embeddings'
import { db } from './db'

export interface IngestResult {
  documentId: string
  filename: string
  pageCount: number
  chunks: number
  textChunks: number
  imageChunks: number
  tableChunks: number
}

/**
 * Ingest a PDF file. The filename is preserved as the document's
 * display name; the bytes are parsed server-side via pdfjs-dist.
 *
 * Returns counts broken down by modality so the API can echo them back.
 */
export async function ingestPdf(
  filename: string,
  pdfBytes: Uint8Array | ArrayBuffer,
): Promise<IngestResult> {
  // 1. Extract per-page text via pdfjs-dist.
  const pages = await extractText(pdfBytes)

  // 2. For each page, derive the three modality inputs.
  const pageInputs: PageInputs[] = pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: p.text,
    images: extractImagePlaceholders(p.text, p.pageNumber),
    tables: detectTables(p.text, p.pageNumber),
  }))

  // 3. Combine into a single multimodal chunk list (ordinal threaded across pages).
  const chunks = chunkDocument(pageInputs)

  // 4. Persist the Document row first so chunks can FK to it.
  const doc = await db.document.create({
    data: {
      filename,
      source: 'upload-pdf',
      pageCount: pages.length,
    },
  })

  // 5. Embed + persist each chunk.
  const provider = getEmbeddingProvider()
  let textChunks = 0
  let imageChunks = 0
  let tableChunks = 0
  for (const c of chunks) {
    const tokens = tokenize(c.content)
    const vec = await provider.embed(c.content)
    await db.documentChunk.create({
      data: {
        documentId: doc.id,
        ordinal: c.ordinal,
        modality: c.modality,
        pageNumber: c.pageNumber,
        heading: c.heading,
        content: c.content,
        bbox: c.bbox,
        tokens: JSON.stringify(tokens),
        embedding: serializeVector(vec),
      },
    })
    if (c.modality === 'text') textChunks += 1
    else if (c.modality === 'image') imageChunks += 1
    else if (c.modality === 'table') tableChunks += 1
  }

  return {
    documentId: doc.id,
    filename,
    pageCount: pages.length,
    chunks: chunks.length,
    textChunks,
    imageChunks,
    tableChunks,
  }
}
