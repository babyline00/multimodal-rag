/**
 * DELETE /api/documents/[id]
 *   Removes the document + cascades its chunks. Invalidates the in-memory
 *   retrieval corpus so the next query doesn't see stale chunks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const existing = await db.document.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    await db.document.delete({ where: { id } })
    invalidateCorpus()
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[api/documents/delete] error:', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
