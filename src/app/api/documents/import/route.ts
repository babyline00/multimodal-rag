/**
 * POST /api/documents/import
 *   multipart/form-data: `file` = a single .pdf file
 *
 * Extracts text + image placeholders + tables from the PDF, embeds each
 * chunk, and persists the Document + DocumentChunk rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ingestPdf } from '@/lib/ingest'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415 })
    }
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })
    }
    const buf = await file.arrayBuffer()
    const result = await ingestPdf(file.name, new Uint8Array(buf))
    invalidateCorpus()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[api/documents/import] error:', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
