/**
 * table-detector tests.
 *
 * `detectTables(pageText, pageNumber)` should detect:
 *   1. pipe-separated (markdown-style) tables — including the separator row
 *      that must NOT be stored as data,
 *   2. tab-separated tables — runs of consecutive lines with the same number
 *      of `\t` separators,
 * and pick up "Table N" captions on the adjacent line if present.
 */
import { test, expect, describe } from 'bun:test'
import { detectTables } from '../table-detector'

describe('detectTables — pipe-separated', () => {
  test('parses a simple 2-row pipe table with header separator', () => {
    const text = [
      'Some intro paragraph.',
      '',
      '| col1 | col2 | col3 |',
      '| --- | --- | --- |',
      '| a | b | c |',
      '| d | e | f |',
      '',
      'Trailing text.',
    ].join('\n')
    const out = detectTables(text, 1)
    expect(out.length).toBe(1)
    const t = out[0]
    expect(t.rows.length).toBe(3) // header + 2 data rows (separator not stored)
    expect(t.rows[0]).toEqual(['col1', 'col2', 'col3'])
    expect(t.rows[1]).toEqual(['a', 'b', 'c'])
    expect(t.rows[2]).toEqual(['d', 'e', 'f'])
    // Markdown rendering includes the header + separator + body
    expect(t.markdown).toContain('| col1 | col2 | col3 |')
    expect(t.markdown).toContain('| --- | --- | --- |')
    expect(t.markdown).toContain('| a | b | c |')
  })

  test('detects a "Table N" caption on the line just before the block', () => {
    const text = [
      'Table 4: Quarterly results',
      '| q | revenue |',
      '| --- | --- |',
      '| q1 | 100 |',
      '| q2 | 200 |',
    ].join('\n')
    const out = detectTables(text, 2)
    expect(out[0].label).toBe('Table 4')
    expect(out[0].pageNumber).toBe(2)
  })

  test('falls back to a position-based label when no caption is found', () => {
    const text = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const out = detectTables(text, 3)
    expect(out[0].label).toContain('page 3')
    expect(out[0].label).toContain('block 1')
  })

  test('does not store the markdown separator row as data', () => {
    const text = [
      '| h1 | h2 |',
      '| :---: | ---: |',
      '| a | b |',
    ].join('\n')
    const out = detectTables(text, 1)
    expect(out[0].rows.length).toBe(2)
    expect(out[0].rows[0]).toEqual(['h1', 'h2'])
    expect(out[0].rows[1]).toEqual(['a', 'b'])
  })
})

describe('detectTables — tab-separated', () => {
  test('parses a tab-separated run as a table', () => {
    const text = [
      'intro line',
      'a\tb\tc',
      'd\te\tf',
      'g\th\ti',
      'trailing line',
    ].join('\n')
    const out = detectTables(text, 7)
    expect(out.length).toBe(1)
    expect(out[0].rows.length).toBe(3)
    expect(out[0].rows[0]).toEqual(['a', 'b', 'c'])
    expect(out[0].rows[2]).toEqual(['g', 'h', 'i'])
    expect(out[0].pageNumber).toBe(7)
  })

  test('breaks the block when tab count differs across lines', () => {
    const text = [
      'a\tb',
      'c\td',
      'e\tf\tg', // different tab count → ends previous block
      'h\ti\tj', // continues a new block
    ].join('\n')
    const out = detectTables(text, 1)
    expect(out.length).toBe(2)
    expect(out[0].rows.length).toBe(2)
    expect(out[1].rows.length).toBe(2)
  })

  test('breaks the block on an empty line', () => {
    const text = [
      'a\tb',
      'c\td',
      '',
      'e\tf',
      'g\th',
    ].join('\n')
    const out = detectTables(text, 1)
    expect(out.length).toBe(2)
    expect(out[0].rows.length).toBe(2)
    expect(out[1].rows.length).toBe(2)
  })

  test('requires at least 2 rows', () => {
    const text = ['a\tb'].join('\n')
    const out = detectTables(text, 1)
    expect(out).toEqual([])
  })
})

describe('detectTables — mixed', () => {
  test('detects both a pipe-table and a tab-table in the same page', () => {
    const text = [
      '| h1 | h2 |',
      '| --- | --- |',
      '| a | b |',
      '',
      'a\tb\tc',
      'd\te\tf',
    ].join('\n')
    const out = detectTables(text, 9)
    expect(out.length).toBe(2)
    expect(out[0].rows[0]).toEqual(['h1', 'h2'])
    expect(out[1].rows[0]).toEqual(['a', 'b', 'c'])
  })

  test('empty input -> []', () => {
    expect(detectTables('', 1)).toEqual([])
  })

  test('no table-shaped lines -> []', () => {
    expect(detectTables('just a paragraph\nwith two lines', 1)).toEqual([])
  })
})
