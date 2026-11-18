/**
 * citation tests.
 *
 * `parseCitations(message)` extracts `[^c1]` markers in order, deduped.
 * `formatCitationCard(source, shortId)` returns a UI-friendly structure
 * with the modality badge + page number + truncated preview.
 */
import { test, expect, describe } from 'bun:test'
import {
  parseCitations,
  resolveCitationSources,
  formatCitationCard,
  modalityBadgeLabel,
  modalityBadgeClass,
  type CitationSource,
} from '../citation'

describe('parseCitations', () => {
  test('extracts short ids in order', () => {
    expect(parseCitations('foo [^c1] bar [^c2] baz [^c3]')).toEqual(['c1', 'c2', 'c3'])
  })
  test('dedupes repeated markers', () => {
    expect(parseCitations('a [^c1] b [^c1] c [^c2]')).toEqual(['c1', 'c2'])
  })
  test('ignores out-of-range or non-c markers', () => {
    expect(parseCitations('[^a1] not a citation')).toEqual([])
    expect(parseCitations('[^cXX] not numeric')).toEqual([])
  })
  test('empty input -> []', () => {
    expect(parseCitations('')).toEqual([])
    expect(parseCitations('no markers here')).toEqual([])
  })
})

describe('resolveCitationSources', () => {
  const map: Record<string, { shortId: string; source: CitationSource }> = {
    'ck-1': { shortId: 'c1', source: mkSource('ck-1', 'text', 4) },
    'ck-2': { shortId: 'c2', source: mkSource('ck-2', 'image', 5) },
    'ck-3': { shortId: 'c3', source: mkSource('ck-3', 'table', 12) },
  }
  test('resolves short ids to sources', () => {
    const out = resolveCitationSources(['c1', 'c3'], map)
    expect(out.length).toBe(2)
    expect(out[0].chunkId).toBe('ck-1')
    expect(out[1].chunkId).toBe('ck-3')
  })
  test('drops short ids not present in the map', () => {
    const out = resolveCitationSources(['c1', 'c99'], map)
    expect(out.length).toBe(1)
    expect(out[0].chunkId).toBe('ck-1')
  })
})

describe('formatCitationCard', () => {
  test('carries the modality badge label + page number + heading', () => {
    const src = mkSource('ck-img-1', 'image', 7, 'Figure 2', '[Figure 2] — placeholder text')
    const card = formatCitationCard(src, 'c1')
    expect(card.shortId).toBe('c1')
    expect(card.modality).toBe('image')
    expect(card.pageNumber).toBe(7)
    expect(card.heading).toBe('Figure 2')
    expect(card.preview).toContain('Figure 2')
  })
  test('truncates the preview when content is long', () => {
    const long = 'word '.repeat(60)
    const src = mkSource('ck-text-1', 'text', 3, 'Page 3', long)
    const card = formatCitationCard(src, 'c2')
    expect(card.truncated).toBe(true)
    expect(card.preview.length).toBeLessThan(long.length)
  })
  test('does not mark short content as truncated', () => {
    const src = mkSource('ck-tab-1', 'table', 9, 'Table 1', '| a | b |')
    const card = formatCitationCard(src, 'c3')
    expect(card.truncated).toBe(false)
    expect(card.preview).toContain('| a | b |')
  })
  test('carries the documentId + filename', () => {
    const src: CitationSource = {
      chunkId: 'ck-x',
      documentId: 'doc-x',
      filename: 'report.pdf',
      modality: 'text',
      pageNumber: 1,
      heading: null,
      content: 'short',
    }
    const card = formatCitationCard(src, 'c1')
    expect(card.documentId).toBe('doc-x')
    expect(card.filename).toBe('report.pdf')
  })
})

describe('modalityBadge helpers', () => {
  test('modalityBadgeLabel maps to TEXT / IMAGE / TABLE', () => {
    expect(modalityBadgeLabel('text')).toBe('TEXT')
    expect(modalityBadgeLabel('image')).toBe('IMAGE')
    expect(modalityBadgeLabel('table')).toBe('TABLE')
  })
  test('modalityBadgeClass returns a Tailwind class string for each modality', () => {
    expect(modalityBadgeClass('text')).toContain('bg-secondary')
    expect(modalityBadgeClass('image')).toContain('amber')
    expect(modalityBadgeClass('table')).toContain('emerald')
  })
})

function mkSource(
  chunkId: string,
  modality: 'text' | 'image' | 'table',
  pageNumber: number,
  heading: string | null = null,
  content = 'sample content',
): CitationSource {
  return {
    chunkId,
    documentId: 'doc-1',
    filename: 'sample.pdf',
    modality,
    pageNumber,
    heading,
    content,
  }
}
