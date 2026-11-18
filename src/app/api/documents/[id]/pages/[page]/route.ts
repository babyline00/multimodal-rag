/**
 * GET /api/documents/[id]/pages/[page]
 *   Returns the extracted content for a single page of a document:
 *   - the raw extracted text (used to render the per-page source view),
 *   - the list of image placeholders (figureLabel + description) on that page,
 *   - the list of detected tables (label + markdown) on that page.
 *
 * The frontend uses this to render the right-hand "Page N" view that opens
 * when a citation is clicked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractImagePlaceholders } from '@/lib/image-extractor'
import { detectTables } from '@/lib/table-detector'

export const runtime = 'nodejs'

interface ImagePlaceholderOut {
  chunkId: string
  figureLabel: string
  descriptionPlaceholder: string
}
interface TableOut {
  chunkId: string
  label: string
  markdown: string
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; page: string }> },
) {
  const { id, page } = await ctx.params
  const pageNumber = parseInt(page, 10)
  if (Number.isNaN(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: 'Invalid page number' }, { status: 400 })
  }
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  // Find all chunks for this page — they carry the embedded text/heading/
  // content for the three modalities. We rebuild the page view from the
  // stored chunks (no need to re-parse the PDF).
  const chunks = await db.documentChunk.findMany({
    where: { documentId: id, pageNumber },
    orderBy: { ordinal: 'asc' },
  })
  if (!chunks.length) {
    return NextResponse.json({ error: 'Page has no extracted content' }, { status: 404 })
  }

  // Reconstruct the page text from text chunks (concatenated in ordinal order).
  const text = chunks
    .filter((c) => c.modality === 'text')
    .map((c) => c.content)
    .join('\n\n')

  const images: ImagePlaceholderOut[] = chunks
    .filter((c) => c.modality === 'image')
    .map((c) => ({
      chunkId: c.id,
      figureLabel: c.heading ?? 'Figure',
      descriptionPlaceholder: c.content,
    }))

  const tables: TableOut[] = chunks
    .filter((c) => c.modality === 'table')
    .map((c) => ({
      chunkId: c.id,
      label: c.heading ?? 'Table',
      markdown: c.content,
    }))

  return NextResponse.json({
    documentId: id,
    filename: doc.filename,
    pageNumber,
    pageCount: doc.pageCount,
    text,
    images,
    tables,
    // Helpful: pre-computed image placeholders from the reconstructed text —
    // lets the UI highlight which figure labels appear in the page text
    // even if no image chunk was created for them (e.g. captions that
    // weren't deduped).
    figureMentions: extractImagePlaceholders(text, pageNumber).map((p) => p.figureLabel),
    tableMentions: detectTables(text, pageNumber).map((t) => t.label),
  })
}
