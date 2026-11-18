/**
 * Markdown-aware body chunker for the TEXT modality.
 *
 * Splits a page's text body into chunks that stay inside a configurable
 * token budget. Adjacent chunks overlap by a sliding window so retrieval
 * does not miss cross-paragraph context.
 *
 * For multimodal RAG we keep the TEXT chunker minimal: the multimodal
 * orchestration (text + image + table) lives in `chunker-multimodal.ts`.
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

const DEFAULT_TARGET_TOKENS = 256
const DEFAULT_OVERLAP_TOKENS = 48

/**
 * Rough-but-stable token estimator. We approximate "tokens" by characters / 4
 * which is the standard rule-of-thumb for English text against BPE tokenizers.
 * It is intentionally cheap — the chunker only needs an approximate budget.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Greedy word-based splitter that keeps paragraphs intact where possible.
 * Returns one or more chunks each <= `targetTokens` tokens (approx).
 */
export function splitBodyByTokens(
  body: string,
  targetTokens: number = DEFAULT_TARGET_TOKENS,
  overlapTokens: number = DEFAULT_OVERLAP_TOKENS,
): string[] {
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const chunks: string[] = []
  let buffer = ''
  let bufferTokens = 0

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim())
    buffer = ''
    bufferTokens = 0
  }

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para)
    if (bufferTokens + paraTokens > targetTokens && bufferTokens > 0) {
      flush()
    }
    // If a single paragraph is itself larger than the target, hard-split it by sentences.
    if (paraTokens > targetTokens) {
      const sentences = para.split(/(?<=[.!?])\s+/)
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence)
        if (bufferTokens + sentenceTokens > targetTokens && bufferTokens > 0) {
          flush()
        }
        buffer += (buffer ? ' ' : '') + sentence
        bufferTokens += sentenceTokens
      }
    } else {
      buffer += (buffer ? '\n\n' : '') + para
      bufferTokens += paraTokens
    }
  }
  flush()

  if (overlapTokens > 0 && chunks.length > 1) {
    const overlapChars = overlapTokens * 4
    const overlapped: string[] = [chunks[0]]
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-overlapChars)
      overlapped.push(`${prevTail}\n\n${chunks[i]}`.trim())
    }
    return overlapped
  }
  return chunks
}
