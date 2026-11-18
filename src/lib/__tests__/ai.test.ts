import { test, expect, describe } from 'bun:test'
import {
  buildMultimodalSystemPrompt,
  extractCitations,
  type ChatProvider,
  getChatProvider,
  __setChatProviderForTest,
} from '../ai'
import type { RetrievedChunk } from '../retrieval'

const retrieved: RetrievedChunk[] = [
  {
    chunkId: 'ck-text-1',
    documentId: 'doc-1',
    filename: 'system-design.pdf',
    modality: 'text',
    ordinal: 1,
    pageNumber: 4,
    heading: 'Page 4',
    content: 'The system is composed of three services: ingest, retrieval, and chat.',
    bm25Score: 4.2,
    vectorScore: 0.81,
    fusedScore: 0.016,
  },
  {
    chunkId: 'ck-image-1',
    documentId: 'doc-1',
    filename: 'system-design.pdf',
    modality: 'image',
    ordinal: 2,
    pageNumber: 5,
    heading: 'Figure 1',
    content: '[Figure 1] — image content not extracted in MVP. Referenced on page 5.',
    bm25Score: 1.1,
    vectorScore: 0.62,
    fusedScore: 0.009,
  },
  {
    chunkId: 'ck-table-1',
    documentId: 'doc-2',
    filename: 'q4-report.pdf',
    modality: 'table',
    ordinal: 8,
    pageNumber: 12,
    heading: 'Table 3',
    content: '| q | rev |\n| --- | --- |\n| q4 | 100 |',
    bm25Score: 3.3,
    vectorScore: 0.74,
    fusedScore: 0.013,
  },
]

describe('buildMultimodalSystemPrompt', () => {
  test('includes the modality badge for every retrieved chunk', () => {
    const { systemPrompt } = buildMultimodalSystemPrompt(retrieved)
    expect(systemPrompt).toContain('[TEXT]')
    expect(systemPrompt).toContain('[IMAGE]')
    expect(systemPrompt).toContain('[TABLE]')
  })
  test('includes the page number of every retrieved chunk', () => {
    const { systemPrompt } = buildMultimodalSystemPrompt(retrieved)
    expect(systemPrompt).toContain('page 4')
    expect(systemPrompt).toContain('page 5')
    expect(systemPrompt).toContain('page 12')
  })
  test('includes the citation rules and the [^c1] marker convention', () => {
    const { systemPrompt } = buildMultimodalSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('citation')
    expect(systemPrompt).toContain('[^c1]')
    expect(systemPrompt.toLowerCase()).toContain('figure')
    expect(systemPrompt.toLowerCase()).toContain('table')
  })
  test('citation map key is the chunkId, value carries shortId + source', () => {
    const { citationMap } = buildMultimodalSystemPrompt(retrieved)
    expect(Object.keys(citationMap).length).toBe(3)
    expect(citationMap['ck-text-1'].shortId).toBe('c1')
    expect(citationMap['ck-image-1'].shortId).toBe('c2')
    expect(citationMap['ck-table-1'].shortId).toBe('c3')
    expect(citationMap['ck-text-1'].source.filename).toBe('system-design.pdf')
    expect(citationMap['ck-image-1'].source.modality).toBe('image')
    expect(citationMap['ck-table-1'].source.pageNumber).toBe(12)
  })
  test('empty retrieved -> safe-mode prompt', () => {
    const { systemPrompt, citationMap } = buildMultimodalSystemPrompt([])
    expect(systemPrompt.toLowerCase()).toContain('no documents')
    expect(Object.keys(citationMap)).toHaveLength(0)
  })
})

describe('extractCitations', () => {
  test('returns chunkIds in citation order', () => {
    const msg =
      'The system has three services [^c1]. See Figure 1 on page 5 [^c2]. ' +
      'Q4 revenue was 100 [^c3].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-text-1', 'ck-image-1', 'ck-table-1'])
  })
  test('dedupes repeated citations', () => {
    const msg = 'A [^c1] then again [^c1].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-text-1'])
  })
  test('ignores out-of-range markers', () => {
    const msg = 'Bogus citation [^c99].'
    expect(extractCitations(msg, retrieved)).toEqual([])
  })
  test('no citations -> []', () => {
    expect(extractCitations('no markers here', retrieved)).toEqual([])
  })
})

describe('ChatProvider (mock)', () => {
  class MockChat implements ChatProvider {
    async *stream(args: { systemPrompt: string; messages: { role: string; content: string }[] }) {
      yield 'mocked response for: '
      yield args.messages[args.messages.length - 1].content
    }
  }
  test('streams concatenated deltas', async () => {
    __setChatProviderForTest(new MockChat())
    const provider = getChatProvider()
    const out: string[] = []
    for await (const d of provider.stream({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      out.push(d)
    }
    expect(out.join('')).toBe('mocked response for: hello')
    __setChatProviderForTest(null)
  })
})
