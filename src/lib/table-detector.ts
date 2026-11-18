/**
 * Heuristic table detector.
 *
 * Two patterns are recognised:
 *
 *  1. **Pipe-separated tables** (markdown-style): a run of >=2 consecutive
 *     lines that look like `| a | b | c |`. The markdown separator row
 *     (`|---|---|`) is recognised as a row delimiter but not stored as data.
 *
 *  2. **Tab-separated tables**: a run of >=2 consecutive non-empty lines
 *     that share the same number of `\t` separators (>=1 tabs / line). This
 *     catches copy-pasted spreadsheet output that never went through a
 *     markdown pretty-printer.
 *
 * The detector is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

export interface DetectedTable {
  /** 1-indexed page number the table appears on. */
  pageNumber: number
  /** "Table 1", "Table 2", ... or `Table (page N, block i)` if no caption. */
  label: string
  /** Each row split into cells. */
  rows: string[][]
  /** Markdown rendering of the rows (header row + separator + body). */
  markdown: string
}

/**
 * Detect a "Table N" caption that may appear on the line just before or just
 * after the table block. If found we use it as the table label; otherwise we
 * fall back to a position-based label.
 */
const TABLE_CAPTION_RE = /\bTable\s*([0-9]+)\b/i

/**
 * Detect tables in a single page's text. Pass the 1-indexed page number so
 * the returned labels + metadata can be used by the multimodal chunker.
 */
export function detectTables(pageText: string, pageNumber: number = 1): DetectedTable[] {
  if (!pageText) return []
  const lines = pageText.replace(/\r\n/g, '\n').split('\n')
  const out: DetectedTable[] = []
  let blockIndex = 0

  let i = 0
  while (i < lines.length) {
    // Try pipe-table first.
    const pipeBlock = consumePipeBlock(lines, i)
    if (pipeBlock.rows.length >= 2) {
      blockIndex += 1
      out.push(buildTable(pageNumber, blockIndex, pipeBlock.rows, lines, pipeBlock.captionLine))
      i = pipeBlock.endIndex
      continue
    }
    // Then tab-table.
    const tabBlock = consumeTabBlock(lines, i)
    if (tabBlock.rows.length >= 2) {
      blockIndex += 1
      out.push(buildTable(pageNumber, blockIndex, tabBlock.rows, lines, tabBlock.captionLine))
      i = tabBlock.endIndex
      continue
    }
    i += 1
  }
  return out
}

interface BlockResult {
  rows: string[][]
  endIndex: number
  captionLine: string | null
}

/**
 * Consume a run of pipe-separated table lines starting at `start`.
 * Returns at least one row when the first line is a pipe-row (caller checks
 * rows.length >= 2).
 */
function consumePipeBlock(lines: string[], start: number): BlockResult {
  const rows: string[][] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isPipeRow(line)) {
      const cells = parsePipeRow(line)
      // Skip the markdown separator row `|---|---|` — it has no real data.
      if (!isPipeSeparatorRow(line)) {
        rows.push(cells)
      }
      i += 1
    } else {
      break
    }
  }
  // Look for a caption immediately before or after the block.
  const captionLine = findCaptionAround(lines, start, i - 1)
  return { rows, endIndex: i, captionLine }
}

/**
 * Consume a run of tab-separated lines starting at `start`. The block ends
 * when we hit a line that doesn't share the same number of tabs as the
 * first line, or an empty line.
 */
function consumeTabBlock(lines: string[], start: number): BlockResult {
  if (start >= lines.length) return { rows: [], endIndex: start, captionLine: null }
  const firstLine = lines[start]
  const tabCount = countTabs(firstLine)
  if (tabCount < 1) return { rows: [], endIndex: start, captionLine: null }
  const rows: string[][] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) break
    if (countTabs(line) !== tabCount) break
    rows.push(line.split('\t').map((c) => c.trim()))
    i += 1
  }
  const captionLine = findCaptionAround(lines, start, i - 1)
  return { rows, endIndex: i, captionLine }
}

function isPipeRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return false
  // Must contain at least one closing pipe (we allow the final pipe to be optional).
  const pipes = (trimmed.match(/\|/g) ?? []).length
  return pipes >= 2
}

function isPipeSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  // A separator row contains only `|`, `-`, `:`, and whitespace.
  return /^\|?[\s:-]+\|[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('-')
}

function parsePipeRow(line: string): string[] {
  // Strip leading + trailing pipes, then split on `|`.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

function countTabs(line: string): number {
  return (line.match(/\t/g) ?? []).length
}

function findCaptionAround(lines: string[], start: number, end: number): string | null {
  // Look one line before and one line after for a "Table N" caption.
  const candidates: string[] = []
  if (start - 1 >= 0) candidates.push(lines[start - 1])
  if (end + 1 < lines.length) candidates.push(lines[end + 1])
  for (const c of candidates) {
    const m = c.match(TABLE_CAPTION_RE)
    if (m) return `Table ${m[1]}`
  }
  return null
}

function buildTable(
  pageNumber: number,
  blockIndex: number,
  rows: string[][],
  _allLines: string[],
  captionLine: string | null,
): DetectedTable {
  const label = captionLine ?? `Table (page ${pageNumber}, block ${blockIndex})`
  // Render as a markdown table — first row is treated as the header.
  const markdown = renderMarkdownTable(rows)
  return { pageNumber, label, rows, markdown }
}

function renderMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return ''
  const colCount = Math.max(...rows.map((r) => r.length))
  const header = rows[0]
  const body = rows.slice(1)
  const pad = (cells: string[]) =>
    cells
      .concat(Array(colCount - cells.length).fill(''))
      .map((c) => ` ${c} `)
      .join('|')
  const sep = Array(colCount).fill('---').map((c) => ` ${c} `).join('|')
  const lines = [
    `|${pad(header)}|`,
    `|${sep}|`,
    ...body.map((r) => `|${pad(r)}|`),
  ]
  return lines.join('\n')
}
