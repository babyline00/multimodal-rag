/**
 * GET /api/stats
 *   Returns corpus counts broken down by modality.
 *   { documents, chunks, textChunks, imageChunks, tableChunks }
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const documents = await db.document.count()
  const chunks = await db.documentChunk.count()
  const [textChunks, imageChunks, tableChunks] = await Promise.all([
    db.documentChunk.count({ where: { modality: 'text' } }),
    db.documentChunk.count({ where: { modality: 'image' } }),
    db.documentChunk.count({ where: { modality: 'table' } }),
  ])
  return NextResponse.json({ documents, chunks, textChunks, imageChunks, tableChunks })
}
