/**
 * text-extractor tests.
 *
 * We mock pdfjs-dist so the tests don't pull in the real WASM worker.
 * The mocks return fixture text-content items per page; we assert that
 * `extractText` returns one entry per page, preserving text order and
 * 1-indexed page numbers, and trims trailing whitespace.
 */
import { test, expect, describe } from 'bun:test'
import {
  extractText,
  __setPdfjsForTest,
  type PdfjsLike,
  type PdfjsDocLike,
  type PdfjsPageLike,
} from '../text-extractor'

function makeMockPdfjs(pages: Array<Array<{ str: string; hasEOL?: boolean }>>): PdfjsLike {
  const doc: PdfjsDocLike = {
    numPages: pages.length,
    getPage: (n: number): Promise<PdfjsPageLike> => {
      const items = pages[n - 1] ?? []
      return Promise.resolve({
        getTextContent: () => Promise.resolve({ items }),
      }) as Promise<PdfjsPageLike>
    },
    destroy: () => Promise.resolve(),
  }
  return {
    getDocument: () => ({ promise: Promise.resolve(doc) }),
    GlobalWorkerOptions: { workerSrc: '' },
  }
}

describe('extractText', () => {
  test('returns one entry per document page with 1-indexed pageNumber', async () => {
    const mock = makeMockPdfjs([
      [{ str: 'Hello ', hasEOL: false }, { str: 'World', hasEOL: true }],
      [{ str: 'Page 2 text', hasEOL: true }],
    ])
    __setPdfjsForTest(mock)
    const pages = await extractText(new Uint8Array([1, 2, 3]), () => Promise.resolve(mock))
    expect(pages.length).toBe(2)
    expect(pages[0]).toEqual({ pageNumber: 1, text: 'Hello World' })
    expect(pages[1]).toEqual({ pageNumber: 2, text: 'Page 2 text' })
    __setPdfjsForTest(null)
  })

  test('joins text items in reading order, respecting hasEOL', async () => {
    const mock = makeMockPdfjs([
      [
        { str: 'Line one', hasEOL: true },
        { str: 'Line two', hasEOL: true },
        { str: 'continued ', hasEOL: false },
        { str: 'word', hasEOL: false },
      ],
    ])
    __setPdfjsForTest(mock)
    const pages = await extractText(new Uint8Array([0]), () => Promise.resolve(mock))
    expect(pages[0].text).toContain('Line one')
    expect(pages[0].text).toContain('Line two')
    expect(pages[0].text).toContain('continued word')
    __setPdfjsForTest(null)
  })

  test('trims trailing whitespace per page', async () => {
    const mock = makeMockPdfjs([
      [{ str: 'Text  ', hasEOL: true }, { str: '  ', hasEOL: false }],
    ])
    __setPdfjsForTest(mock)
    const pages = await extractText(new Uint8Array([0]), () => Promise.resolve(mock))
    expect(pages[0].text).toBe(pages[0].text.trim())
    expect(pages[0].text.endsWith(' ')).toBe(false)
    __setPdfjsForTest(null)
  })

  test('emits empty text for image-only / blank pages', async () => {
    const mock = makeMockPdfjs([
      [{ str: 'Page 1 has text', hasEOL: true }],
      [], // image-only / blank
      [{ str: 'Page 3 has text', hasEOL: true }],
    ])
    __setPdfjsForTest(mock)
    const pages = await extractText(new Uint8Array([0]), () => Promise.resolve(mock))
    expect(pages.length).toBe(3)
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[1].text).toBe('')
    __setPdfjsForTest(null)
  })

  test('accepts ArrayBuffer input as well as Uint8Array', async () => {
    const mock = makeMockPdfjs([[{ str: 'buf text', hasEOL: true }]])
    __setPdfjsForTest(mock)
    const buf = new ArrayBuffer(2)
    const pages = await extractText(buf, () => Promise.resolve(mock))
    expect(pages.length).toBe(1)
    expect(pages[0].text).toBe('buf text')
    __setPdfjsForTest(null)
  })

  test('empty document returns []', async () => {
    const mock = makeMockPdfjs([])
    __setPdfjsForTest(mock)
    const pages = await extractText(new Uint8Array([0]), () => Promise.resolve(mock))
    expect(pages).toEqual([])
    __setPdfjsForTest(null)
  })
})
