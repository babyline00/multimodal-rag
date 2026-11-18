/**
 * Streaming multimodal RAG chat. Wraps the z-ai-web-dev-sdk chat completion
 * endpoint with a retrieval-augmented system prompt that tells the model
 * the modality + page number of each retrieved chunk and instructs it to
 * ground every claim in a chunk via inline `[^c1]` markers.
 *
 * The caller (Next.js Route Handler) is responsible for turning the SDK
 * response into a streaming `ReadableStream` for the frontend.
 *
 * Vision hook: when `MMRAG_ENABLE_VISION=1` AND a real image source is
 * provided, `describeImage()` calls `z-ai-web-dev-sdk`'s `createVision`. In
 * the default MVP path, the image chunks already carry a placeholder
 * description built by `image-extractor.ts` and `describeImage` is unused
 * — but the seam is here so the stretch-goal "real image understanding"
 * path can be turned on with one env var.
 */

import type { RetrievedChunk } from '@/lib/retrieval'
import type { CitationSource } from '@/lib/citation'
import { modalityBadgeLabel } from '@/lib/citation'

export interface ChatProvider {
  /** Returns an async generator of text deltas. */
  stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown>
}

let cachedProvider: ChatProvider | null = null

class ZaiProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system' as const, content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    })

    // The SDK returns either a string, a ReadableStream<Uint8Array> (when
    // stream:true and the server responds with text/event-stream or
    // text/plain), or a non-streaming JSON object. Handle all three.
    if (typeof completion === 'string') {
      yield completion
      return
    }
    let body: ReadableStream<Uint8Array> | undefined
    if (completion && typeof (completion as any).getReader === 'function') {
      // completion IS the ReadableStream (this is what the SDK returns when streaming)
      body = completion as ReadableStream<Uint8Array>
    } else {
      body = (completion as any)?.body ?? (completion as any)?._body
    }
    if (!body) {
      const content = (completion as any)?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.length > 0) yield content
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          return
        }
        try {
          const obj = JSON.parse(payload)
          const delta = obj?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta
          }
        } catch {
          // ignore partial JSON
        }
      }
    }
  }
}

class MockProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    // Deterministic mock that echoes the retrieved context. Used by tests and
    // when the SDK config is unavailable so the UI stays demoable offline.
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    yield `**[mock assistant]** You asked: "${text.slice(0, 120)}". ` +
      `(No live LLM configured — set the SDK config to enable real streaming.)`
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider
  if (process.env.MMRAG_DISABLE_LLM === '1') {
    cachedProvider = new MockProvider()
    return cachedProvider
  }
  try {
    cachedProvider = new ZaiProvider()
  } catch (e) {
    console.warn('[chat] ZaiProvider unavailable, using MockProvider:', (e as Error).message)
    cachedProvider = new MockProvider()
  }
  return cachedProvider
}

/** Test-only. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p
}

/**
 * Build the multimodal RAG system prompt. Each retrieved chunk is presented
 * with its modality badge + page number + content so the LLM can:
 *  - cite TEXT chunks as "see page N"
 *  - cite IMAGE chunks as "see Figure X on page N"
 *  - cite TABLE chunks as "see Table Y on page N"
 * and emit `[^c1]` / `[^c2]` markers that resolve back to the cited chunks
 * in the UI.
 *
 * Returns the system prompt and a map from chunkId -> { shortId, source } so
 * the chat API can persist citations alongside the assistant message.
 */
export function buildMultimodalSystemPrompt(retrieved: RetrievedChunk[]): {
  systemPrompt: string
  citationMap: Record<string, { shortId: string; source: CitationSource }>
} {
  if (!retrieved.length) {
    return {
      systemPrompt:
        'You are Multimodal RAG. No documents have been uploaded yet. ' +
        'Answer the user\'s question briefly and tell them to upload a PDF to enable grounded answers.',
      citationMap: {},
    }
  }
  const chunkLines: string[] = []
  const citationMap: Record<string, { shortId: string; source: CitationSource }> = {}
  retrieved.forEach((c, i) => {
    const shortId = `c${i + 1}`
    const badge = modalityBadgeLabel(c.modality)
    const headingSuffix = c.heading ? ` › ${c.heading}` : ''
    chunkLines.push(
      `[^${shortId}]: [${badge}] (chunkId=${c.chunkId}) ` +
      `Source: "${c.filename}"${headingSuffix} (page ${c.pageNumber})\n` +
      c.content,
    )
    citationMap[c.chunkId] = {
      shortId,
      source: {
        chunkId: c.chunkId,
        documentId: c.documentId,
        filename: c.filename,
        modality: c.modality,
        pageNumber: c.pageNumber,
        heading: c.heading,
        content: c.content,
      },
    }
  })
  const systemPrompt = [
    'You are Multimodal RAG — a RAG assistant that answers questions strictly grounded in the user\'s uploaded PDF documents.',
    'Each retrieved chunk below is tagged with a modality badge (TEXT, IMAGE, or TABLE) and the page number it appears on.',
    'Rules:',
    '1. Answer ONLY using the information present in the provided chunks. If the answer is not in the chunks, say "I don\'t have that in the uploaded PDFs."',
    '2. Every factual claim MUST be followed by an inline citation in the form [^c1], [^c2], etc. — the marker MUST match the chunk label.',
    '3. When citing a TEXT chunk, refer to it as "page N". When citing an IMAGE chunk, refer to it as "Figure X on page N". When citing a TABLE chunk, refer to it as "Table Y on page N".',
    '4. Do not fabricate sources. Do not invent quotes. Do not paraphrase beyond what the chunks support.',
    '5. Use markdown for structure (lists, code blocks, emphasis) where it improves readability.',
    '',
    'Retrieved chunks:',
    chunkLines.join('\n\n---\n\n'),
  ].join('\n')
  return { systemPrompt, citationMap }
}

/**
 * Map short citation markers like [^c1] in the assistant message back to
 * chunk IDs from the citation map. Returns an ordered list of unique
 * chunkIds actually cited in the message.
 */
export function extractCitations(message: string, retrieved: RetrievedChunk[]): string[] {
  const seen = new Set<string>()
  const re = /\[\^(c\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const idx = parseInt(m[1].slice(1), 10) - 1
    if (idx >= 0 && idx < retrieved.length) {
      seen.add(retrieved[idx].chunkId)
    }
  }
  return Array.from(seen)
}

/**
 * (Stretch goal) Describe an image via z-ai-web-dev-sdk's createVision. Only
 * called when MMRAG_ENABLE_VISION=1 AND an image base64/url is provided by a
 * future real-image-extraction path. Returns a short textual description that
 * can be stored as the chunk's `content`.
 */
export async function describeImage(
  imageBase64OrUrl: string,
  prompt: string = 'Describe this figure concisely for retrieval indexing.',
): Promise<string | null> {
  if (process.env.MMRAG_ENABLE_VISION !== '1') return null
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const vision = await ZAI.createVision(zai as any)
    const res = await vision.describe(imageBase64OrUrl, prompt)
    return typeof res === 'string' ? res : (res as any)?.description ?? null
  } catch (e) {
    console.warn('[vision] describeImage failed:', (e as Error).message)
    return null
  }
}
