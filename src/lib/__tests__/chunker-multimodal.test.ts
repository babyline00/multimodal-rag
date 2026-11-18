/**
 * chunker-multimodal tests.
 *
 * Verifies that combining the three modality inputs (text + images + tables)
 * for a page produces DocumentChunk rows with the correct `modality`,
 * `heading`, `pageNumber`, `content`, and `ordinal` — and that the ordinal is
 * threaded across pages by the document-level orchestrator.
 */
import { test, expect, describe } from 'bun:test'
import {
  chunkPage,
  chunkDocument,
  type PageInputs,
} from '../chunker-multimodal'
import type { ImagePlaceholder } from '../image-extractor'
import type { DetectedTable } from '../table-detector'

describe('chunkPage', () => {
  test('produces text + image + table chunks with the correct modalities', () => {
    const page: PageInputs = {
      pageNumber: 1,
      text: 'A short paragraph of body text on page 1.',
      images: [
        {
          pageNumber: 1,
          figureLabel: 'Figure 1',
          descriptionPlaceholder: '[Figure 1] — image content not extracted in MVP.',
        },
      ],
      tables: [
        {
          pageNumber: 1,
          label: 'Table 1',
          rows: [['a', 'b'], ['1', '2']],
          markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |',
        },
      ],
    }
    const { chunks, nextOrdinal } = chunkPage(page, 1)
    expect(chunks.length).toBe(3)
    expect(chunks[0].modality).toBe('text')
    expect(chunks[0].pageNumber).toBe(1)
    expect(chunks[0].heading).toBe('Page 1')
    expect(chunks[1].modality).toBe('table')
    expect(chunks[1].heading).toBe('Table 1')
    expect(chunks[1].content).toContain('| a | b |')
    expect(chunks[2].modality).toBe('image')
    expect(chunks[2].heading).toBe('Figure 1')
    expect(chunks[2].content).toContain('[Figure 1]')
    expect(nextOrdinal).toBe(4)
  })

  test('ordinals start at startOrdinal and increment by 1', () => {
    const page: PageInputs = {
      pageNumber: 5,
      text: 'Body text.',
      images: [],
      tables: [],
    }
    const { chunks } = chunkPage(page, 100)
    expect(chunks[0].ordinal).toBe(100)
    expect(chunks.length).toBe(1)
  })

  test('skips empty text but still emits image + table chunks', () => {
    const page: PageInputs = {
      pageNumber: 2,
      text: '   ',
      images: [
        {
          pageNumber: 2,
          figureLabel: 'Figure 2',
          descriptionPlaceholder: 'image 2 placeholder',
        },
      ],
      tables: [],
    }
    const { chunks } = chunkPage(page, 1)
    expect(chunks.length).toBe(1)
    expect(chunks[0].modality).toBe('image')
  })

  test('long page text splits into multiple text chunks (text-only page)', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i}.`).join(' ')
    const page: PageInputs = {
      pageNumber: 1,
      text: long,
      images: [],
      tables: [],
    }
    const { chunks } = chunkPage(page, 1, { targetTokens: 64, overlapTokens: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.modality === 'text')).toBe(true)
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i + 1))
  })

  test('bbox is null for MVP', () => {
    const page: PageInputs = {
      pageNumber: 1,
      text: 'Body.',
      images: [
        {
          pageNumber: 1,
          figureLabel: 'Figure 1',
          descriptionPlaceholder: 'placeholder',
        },
      ],
      tables: [],
    }
    const { chunks } = chunkPage(page, 1)
    expect(chunks.every((c) => c.bbox === null)).toBe(true)
  })
})

describe('chunkDocument', () => {
  test('threads the ordinal across pages so the final list is 1..N', () => {
    const pages: PageInputs[] = [
      { pageNumber: 1, text: 'Page 1 body.', images: [], tables: [] },
      {
        pageNumber: 2,
        text: 'Page 2 body.',
        images: [
          {
            pageNumber: 2,
            figureLabel: 'Figure 1',
            descriptionPlaceholder: 'img1',
          },
        ],
        tables: [],
      },
      {
        pageNumber: 3,
        text: '',
        images: [],
        tables: [
          {
            pageNumber: 3,
            label: 'Table 1',
            rows: [['x'], ['1']],
            markdown: '| x |\n| --- |\n| 1 |',
          },
        ],
      },
    ]
    const chunks = chunkDocument(pages)
    expect(chunks.length).toBe(4)
    expect(chunks.map((c) => c.ordinal)).toEqual([1, 2, 3, 4])
    expect(chunks[0].modality).toBe('text') // page 1 text
    expect(chunks[1].modality).toBe('text') // page 2 text
    expect(chunks[2].modality).toBe('image') // page 2 image
    expect(chunks[3].modality).toBe('table') // page 3 table (no text)
  })

  test('empty document (all-blank pages) -> []', () => {
    const chunks = chunkDocument([
      { pageNumber: 1, text: '   ', images: [], tables: [] },
      { pageNumber: 2, text: '', images: [], tables: [] },
    ])
    expect(chunks).toEqual([])
  })

  test('order is text -> table -> image within a page', () => {
    const page: PageInputs = {
      pageNumber: 1,
      text: 'Body.',
      images: [
        {
          pageNumber: 1,
          figureLabel: 'Figure 1',
          descriptionPlaceholder: 'img',
        },
      ],
      tables: [
        {
          pageNumber: 1,
          label: 'Table 1',
          rows: [['h'], ['1']],
          markdown: '| h |\n| --- |\n| 1 |',
        },
      ],
    }
    const chunks = chunkDocument([page])
    expect(chunks.map((c) => c.modality)).toEqual(['text', 'table', 'image'])
  })
})
