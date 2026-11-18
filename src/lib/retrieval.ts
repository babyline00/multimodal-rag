/**
 * Retrieval service: given a user query and (optionally) a filtered set of
 * document IDs, returns the top-K most relevant chunks via hybrid retrieval.
 *
 * Loads the corpus into memory on first use and rebuilds when chunks are
 * added/removed. For the multimodal RAG scale (10^2-10^4 chunks across
 * documents) in-memory is the right choice; for larger corpora this is
 * where you would swap in pgvector / Tantivy / a hosted retrieval service.
 *
 * The corpus includes chunks of all three modalities (text / image / table)
 * stored in the same `DocumentChunk` table — retrieval is modality-agnostic
 * at this layer; the chat API and UI handle modality-aware rendering.
 */

import { db } from '@/lib/db'
import { tokenize } from '@/lib/tokenizer'
import { BM25Index } from '@/lib/bm25'
import {
  getEmbeddingProvider,
  cosine,
  deserializeVector,
  type EmbeddingProvider,
} from '@/lib/embeddings'
import { fuseHits, type SearchHit } from '@/lib/hybrid-search'
import type { Modality } from '@/lib/chunker-multimodal'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  filename: string
  modality: Modality
  ordinal: number
  pageNumber: number
  heading: string | null
  content: string
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

const TOP_K = 8

interface CorpusState {
  // Flat arrays of chunk metadata + tokens + vectors. We keep these in
  // parallel arrays so the BM25 / vector loops are tight and cache-friendly.
  chunkIds: string[]
  documentIds: string[]
  filenames: string[]
  modalities: Modality[]
  ordinals: number[]
  pageNumbers: number[]
  headings: (string | null)[]
  contents: string[]
  tokens: string[][]
  vectors: Float32Array[]
  bm25: BM25Index
  signature: string // hash of chunk count + latest id to detect stale state
}

let corpusState: CorpusState | null = null

async function computeCorpusSignature(): Promise<string> {
  const count = await db.documentChunk.count()
  // Cheap signature: max createdAt + count — invalidates whenever we add/remove chunks
  const latest = await db.documentChunk.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  return `${count}:${latest?.id ?? ''}`
}

async function loadCorpus(provider: EmbeddingProvider): Promise<CorpusState> {
  const chunks = await db.documentChunk.findMany({
    include: { document: { select: { filename: true } } },
    orderBy: { ordinal: 'asc' },
  })

  const chunkIds: string[] = []
  const documentIds: string[] = []
  const filenames: string[] = []
  const modalities: Modality[] = []
  const ordinals: number[] = []
  const pageNumbers: number[] = []
  const headings: (string | null)[] = []
  const contents: string[] = []
  const tokens: string[][] = []
  const vectors: Float32Array[] = []

  for (const c of chunks) {
    chunkIds.push(c.id)
    documentIds.push(c.documentId)
    filenames.push(c.document.filename)
    modalities.push(c.modality as Modality)
    ordinals.push(c.ordinal)
    pageNumbers.push(c.pageNumber)
    headings.push(c.heading)
    contents.push(c.content)
    try {
      tokens.push(JSON.parse(c.tokens) as string[])
    } catch {
      tokens.push(tokenize(c.content))
    }
    try {
      vectors.push(deserializeVector(c.embedding))
    } catch {
      vectors.push(await provider.embed(c.content))
    }
  }

  return {
    chunkIds,
    documentIds,
    filenames,
    modalities,
    ordinals,
    pageNumbers,
    headings,
    contents,
    tokens,
    vectors,
    bm25: new BM25Index(tokens.map((t, i) => ({ id: chunkIds[i], tokens: t }))),
    signature: await computeCorpusSignature(),
  }
}

async function getCorpus(): Promise<CorpusState> {
  const sig = await computeCorpusSignature()
  if (corpusState && corpusState.signature === sig) {
    return corpusState
  }
  const provider = getEmbeddingProvider()
  corpusState = await loadCorpus(provider)
  return corpusState
}

/** Force a reload on next access — used by the import API after adding documents. */
export function invalidateCorpus() {
  corpusState = null
}

export interface RetrieveOptions {
  /** When set, only chunks from these document IDs are searched. */
  filterDocumentIds?: string[]
  topK?: number
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K
  const corpus = await getCorpus()
  if (!corpus.chunkIds.length) return []

  // Build filtered index arrays
  const filter = opts.filterDocumentIds && opts.filterDocumentIds.length > 0
    ? new Set(opts.filterDocumentIds)
    : null

  const filteredIdx: number[] = []
  for (let i = 0; i < corpus.chunkIds.length; i++) {
    if (filter && !filter.has(corpus.documentIds[i])) continue
    filteredIdx.push(i)
  }
  if (!filteredIdx.length) return []

  const bm25Hits = (() => {
    if (!filter) {
      // Fast path: use the corpus-level BM25 index directly
      return corpus.bm25.search(query, topK * 2)
    }
    // Slow path: filtered — build a tiny BM25 index from the slice
    const filteredDocs = filteredIdx.map((i) => ({
      id: corpus.chunkIds[i],
      tokens: corpus.tokens[i],
    }))
    const sub = new BM25Index(filteredDocs)
    return sub.search(query, topK * 2)
  })()

  const provider = getEmbeddingProvider()
  const qVec = await provider.embed(query)

  // Vector similarity over the filtered slice
  const vecHits = filteredIdx
    .map((i) => ({
      id: corpus.chunkIds[i],
      score: cosine(qVec, corpus.vectors[i]),
      idx: i,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)

  const fused = fuseHits(
    bm25Hits.map((h) => ({ id: h.id, score: h.score })),
    vecHits.map((h) => ({ id: h.id, score: h.score })),
    { topK },
  )

  const idToIdx = new Map(corpus.chunkIds.map((id, i) => [id, i]))
  return fused.map((f): RetrievedChunk => {
    const i = idToIdx.get(f.id)!
    return {
      chunkId: corpus.chunkIds[i],
      documentId: corpus.documentIds[i],
      filename: corpus.filenames[i],
      modality: corpus.modalities[i],
      ordinal: corpus.ordinals[i],
      pageNumber: corpus.pageNumbers[i],
      heading: corpus.headings[i],
      content: corpus.contents[i],
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      fusedScore: f.fusedScore,
    }
  })
}

/** Total chunk count — used by the UI to show "X docs / Y chunks indexed". */
export async function corpusStats(): Promise<{
  documents: number
  chunks: number
  textChunks: number
  imageChunks: number
  tableChunks: number
}> {
  const documents = await db.document.count()
  const chunks = await db.documentChunk.count()
  const [textChunks, imageChunks, tableChunks] = await Promise.all([
    db.documentChunk.count({ where: { modality: 'text' } }),
    db.documentChunk.count({ where: { modality: 'image' } }),
    db.documentChunk.count({ where: { modality: 'table' } }),
  ])
  return { documents, chunks, textChunks, imageChunks, tableChunks }
}
