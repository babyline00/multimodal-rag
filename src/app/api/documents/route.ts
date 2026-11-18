/**
 * GET /api/documents
 *   Returns the list of uploaded documents with per-modality chunk counts.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const docs = await db.document.findMany({
    orderBy: { ingestedAt: 'desc' },
    select: {
      id: true,
      filename: true,
      source: true,
      pageCount: true,
      ingestedAt: true,
      chunks: {
        select: { modality: true },
      },
    },
  })
  const out = docs.map((d) => {
    const textChunks = d.chunks.filter((c) => c.modality === 'text').length
    const imageChunks = d.chunks.filter((c) => c.modality === 'image').length
    const tableChunks = d.chunks.filter((c) => c.modality === 'table').length
    return {
      id: d.id,
      filename: d.filename,
      source: d.source,
      pageCount: d.pageCount,
      ingestedAt: d.ingestedAt,
      chunks: d.chunks.length,
      textChunks,
      imageChunks,
      tableChunks,
    }
  })
  return NextResponse.json({ documents: out })
}
