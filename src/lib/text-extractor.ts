/**
 * PDF text extraction via pdfjs-dist.
 *
 * Given an ArrayBuffer (or Uint8Array) of a PDF file, extract the text of each
 * page and emit `[{ pageNumber, text }]`. The caller (ingest pipeline) then
 * feeds each page through the three modality extractors (text / image / table)
 * to produce a single `DocumentChunk` stream.
 *
 * Design notes:
 *  - We import pdfjs-dist lazily inside `extractText` so that the module
 *    can be loaded in unit-test environments where pdfjs is mocked.
 *  - We set `pdfjsLib.GlobalWorkerOptions.workerSrc` to a sentinel string
 *    because the library insists on a worker URL even when `disableWorker`
 *    is implied by passing a buffer. The sentinel value is never fetched
 *    because we never run the worker in our server-side extraction path.
 *  - The text content of each page is joined by newline in the order the
 *    text items appear in the page's content stream (which is the canonical
 *    "reading order" for the vast majority of PDFs).
 */

export interface PdfPageText {
  /** 1-indexed page number. */
  pageNumber: number
  /** The extracted text for the page (may be empty for image-only pages). */
  text: string
}

/**
 * The shape of pdfjs-dist that we actually use. We type it ourselves so the
 * test mocks don't need to depend on the heavy real module.
 */
export interface PdfjsLike {
  getDocument: (args: { data: Uint8Array }) => {
    promise: Promise<PdfjsDocLike>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

export interface PdfjsDocLike {
  numPages: number
  getPage: (n: number) => Promise<PdfjsPageLike>
  destroy?: () => Promise<void> | void
}

export interface PdfjsPageLike {
  getTextContent: () => Promise<{
    items: Array<{ str?: string; hasEOL?: boolean }>
  }>
}

let cachedPdfjs: PdfjsLike | null = null

async function loadPdfjs(): Promise<PdfjsLike> {
  if (cachedPdfjs) return cachedPdfjs
  // Dynamic import — keeps the heavy PDF parser out of the cold-start path
  // and lets tests substitute a mock before the first call.
  const mod = (await import('pdfjs-dist')) as unknown as PdfjsLike & {
    version?: string
  }
  // Set a no-op worker URL to silence the "no workerSrc" warning. We pass the
  // entire buffer to getDocument which disables worker-side streaming.
  try {
    mod.GlobalWorkerOptions.workerSrc = ''
  } catch {
    /* ignore — GlobalWorkerOptions may be read-only in mocks */
  }
  cachedPdfjs = mod
  return mod
}

/** Test-only: inject a mock pdfjs implementation. */
export function __setPdfjsForTest(p: PdfjsLike | null) {
  cachedPdfjs = p
}

/**
 * Extract text per page from a PDF. The `loader` argument lets tests inject a
 * mock pdfjs-dist implementation that returns fixture data.
 *
 * Returns `[{ pageNumber, text }]` (one entry per document page, including
 * image-only / blank pages — text will be empty for those).
 */
export async function extractText(
  data: Uint8Array | ArrayBuffer,
  loader: (() => Promise<PdfjsLike>) | null = null,
): Promise<PdfPageText[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const pdfjs = loader ? await loader() : await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const pages: PdfPageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (typeof item.str === 'string') {
        text += item.str
        if (item.hasEOL) text += '\n'
        else text += ' '
      }
    }
    // Collapse multiple spaces/tabs (pdfjs often emits trailing-space items
    // followed by a non-EOL separator that adds another space) and trim the
    // final per-line whitespace before joining.
    pages.push({
      pageNumber: i,
      text: text
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .trim(),
    })
  }
  if (typeof doc.destroy === 'function') {
    await Promise.resolve(doc.destroy())
  }
  return pages
}
