# Multimodal RAG (Text + Image + Table)

Enterprise RAG that ingests PDFs with **text**, **images**, and **tables**
and unifies all three modalities in a single `DocumentChunk` table. Hybrid
BM25 + vector retrieval fused via Reciprocal Rank Fusion (RRF) returns
chunks of any modality per query; the assistant cites them inline as
`[^c1]` and the UI renders each citation as a card with a **modality
badge** (TEXT / IMAGE / TABLE), a page number, and a preview. Clicking a
citation opens a **per-page source view** showing the extracted text,
image placeholder boxes, and rendered table markdown for that page.

> Rebuild of project #75 from the 110-project portfolio plan.

## MVP scope vs. stretch goals

| Capability | MVP (this build) | Stretch goal |
| --- | --- | --- |
| PDF text extraction | `pdfjs-dist` per-page text → text chunks | — |
| Image extraction | Detect "Figure X" captions + page numbers; store placeholder descriptions | Real image bytes extraction + `createVision` description + real CLIP embeddings |
| Table extraction | Heuristic: pipe-separated OR consecutive lines with same `\t` count | Real table-structure detection (e.g. Camelot, TableTransformer) |
| Page retrieval | Chunk-level retrieval with `pageNumber` metadata | ColPali-style page-level multi-vector retrieval |
| Chart understanding | Out of scope | Vision LLM over chart crops for trend/axis extraction |
| Embeddings | Deterministic hashing-trick (384-dim), runs fully offline | OpenAI-compatible / Ollama via env vars (already wired) |
| LLM streaming | `z-ai-web-dev-sdk` chat completions + MockProvider fallback | — |

The MVP is intentionally fully runnable in a sandbox with **zero external
API keys** thanks to the hashing-trick embedder and the MockProvider chat
fallback. Real semantic embeddings can be turned on with one env var.

## Features

- **PDF ingestion with three modalities in one table** — every chunk has a
  `modality` column (`text` / `image` / `table`) plus a `pageNumber`,
  `heading` (`Page N` / `Figure X` / `Table Y`), and `content`. Tables are
  rendered back to markdown; images are stored as placeholder descriptions.
- **Image placeholders** — "Figure X" mentions in the text are detected
  (case-insensitive, supports "Figure", "Fig.", "Fig" prefixes) and one
  placeholder per unique (page, label) is recorded with a description that
  includes a snippet of surrounding text. The placeholder is embeddable so
  queries like "show me Figure 3" retrieve the image chunk.
- **Table detection** — two heuristics: markdown-style pipe tables
  (separator row recognised but not stored as data) AND runs of consecutive
  tab-separated lines with the same `\t` count. Adjacent "Table N"
  captions are picked up as the table label.
- **Hybrid retrieval** — Okapi BM25 (sparse) + 384-dim hashing-trick dense
  embeddings fused via RRF (k=60). All three modalities live in the same
  index so a query returns whichever chunk is most relevant, regardless of
  type.
- **Visual citations** — assistant cites as `[^c1]`. Each citation card
  carries a modality badge (TEXT=neutral / IMAGE=amber / TABLE=emerald — no
  indigo/blue per project rules), a page number, and a preview (text body,
  placeholder text, or table markdown). Clicking opens the per-page source
  view.
- **Per-page source view** — clicking a citation fetches the page view
  (`GET /api/documents/[id]/pages/[page]`) and renders the extracted text
  + image placeholder boxes + rendered table markdown for that page, so the
  user can verify the grounding source.
- **Per-document filter** — tick document checkboxes in the sidebar to
  scope retrieval to a subset.
- **Corpus stats** — header shows live counts of documents, total chunks,
  and chunks per modality.

## Tech Stack

- **Framework**: Next.js 16 (App Router), TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York), Lucide icons
- **Database**: Prisma 6 + SQLite (single isolated DB file)
- **PDF parsing**: `pdfjs-dist` (server-side, lazy import)
- **AI**: `z-ai-web-dev-sdk` (streaming chat completions; `createVision`
  seam present for the image-understanding stretch goal)
- **Tests**: `bun test` (Bun's built-in runner)
- **Lint**: `eslint-config-next` (TypeScript + core-web-vitals)

## Architecture

```
                       ┌───────────────────────────────────┐
   upload.pdf ────────▶│  POST /api/documents/import        │
                       │   ├─ extractText (pdfjs-dist)       │  per page:
                       │   ├─ extractImagePlaceholders       │  ├─ text body
                       │   ├─ detectTables                  │  ├─ Figure X captions
                       │   ├─ chunkDocument (text+img+tab)  │  └─ pipe/tab tables
                       │   └─ embed each chunk + persist    │
                       └────────────┬───────────────────────┘
                                    ▼
                       ┌────────────────────────────────┐
                       │   SQLite (Prisma 6)             │
                       │   ├─ Document                   │
                       │   ├─ DocumentChunk (modality,    │
                       │   │   pageNumber, heading,      │
                       │   │   content, tokens, embedding)│
                       │   └─ ChatSession ChatMessage    │
                       └────────────┬───────────────────┘
                                    ▼
   user query ───────▶  POST /api/chat
                       ├─ retrieve(query, filterDocIds)
                       │   ├─ BM25Index.search         (sparse)
                       │   ├─ cosine(qVec, chunks)     (dense)
                       │   └─ fuseHits (RRF k=60)     (fusion)
                       ├─ buildMultimodalSystemPrompt
                       │   (per-chunk modality + page + content)
                       ├─ provider.stream(...) → text/plain deltas
                       └─ \n---CITATIONS---\n{json with modality + page}

   click citation ──▶  GET /api/documents/[id]/pages/[page]
                       └─ { text, images, tables, mentions }
                            → right column page view
```

## Setup

```bash
# 1. Install deps
bun install

# 2. Configure DB (absolute path is REQUIRED for SQLite + Prisma)
echo "DATABASE_URL=file:$(pwd)/db/custom.db" > .env

# 3. Push the schema (creates db/custom.db)
bun run db:push

# 4. (Optional) Generate the Prisma client
bun run db:generate

# 5. Run the dev server
bun run dev
# → http://localhost:3000  (only `/` is user-visible)
```

## Tests

The suite is intentionally fast (sub-200ms) and DB-free — every test is a
pure-function unit test over the multimodal pipeline components.

```bash
bun test
```

Coverage (52 tests across 9 files):

| File                          | Tests | Focus |
| ----------------------------- | ----: | ----- |
| `text-extractor.test.ts`      | 6  | pdfjs-dist mock, per-page text, 1-indexed page numbers |
| `image-extractor.test.ts`     | 7  | "Figure X" detection, dedupe, page refs, snippets |
| `table-detector.test.ts`      | 11 | pipe + tab tables, caption picking, separator handling |
| `chunker-multimodal.test.ts`  | 8  | text→table→image order, ordinal threading, empty-page skip |
| `tokenizer.test.ts`           | 6  | lowercase / md-strip / CJK / stop words |
| `embeddings.test.ts`          | 7  | determinism + cosine + serialize round-trip |
| `bm25.test.ts`                | 6  | Okapi BM25 ranking |
| `hybrid-search.test.ts`       | 7  | RRF fusion + multi-retriever |
| `ai.test.ts`                  | 10 | multimodal system prompt (badge + page) + citations + MockProvider |
| `citation.test.ts`            | 11 | parseCitations + formatCitationCard + modality badge helpers |

## Environment Variables

The app runs out-of-the-box with **no** API keys thanks to the deterministic
hashing-trick embedder + MockProvider LLM. To enable real semantic
embeddings, live LLM streaming, or the image-understanding stretch goal,
configure the vars below.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `DATABASE_URL` | — | Absolute file path to the SQLite DB (required). |
| `MMRAG_DISABLE_LLM` | — | `1` forces the `MockProvider` (echoes the question). |
| `EMBEDDINGS_API_KEY` | — | Set to enable OpenAI-compatible embeddings. |
| `OPENAI_API_KEY` | — | Fallback key name if `EMBEDDINGS_API_KEY` is unset. |
| `EMBEDDINGS_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint. |
| `EMBEDDINGS_MODEL` | `text-embedding-3-small` | Model name passed to the endpoint. |
| `MMRAG_ENABLE_VISION` | — | `1` enables `createVision` for the real image-understanding path. |

### Local-first via Ollama

The same `EMBEDDINGS_*` env vars work against a local
[Ollama](https://ollama.com) server. No data leaves your machine in this
mode.

```bash
ollama pull nomic-embed-text
ollama serve   # exposes http://localhost:11434

EMBEDDINGS_API_KEY=ollama
EMBEDDINGS_BASE_URL=http://localhost:11434/v1
EMBEDDINGS_MODEL=nomic-embed-text
```

## Project Structure

```
75-multimodal-rag/
├── prisma/schema.prisma                # Document / DocumentChunk / Chat*
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Root layout + Toaster
│   │   ├── page.tsx                     # 3-column workspace (only visible route)
│   │   ├── globals.css                  # Tailwind v4 + theme tokens + image-placeholder-box
│   │   └── api/
│   │       ├── documents/route.ts            # GET list with per-modality counts
│   │       ├── documents/import/route.ts     # POST multipart file=PDF
│   │       ├── documents/[id]/route.ts       # DELETE
│   │       ├── documents/[id]/pages/[page]/route.ts   # GET per-page source view
│   │       ├── chat/route.ts                 # POST streaming RAG with modality-aware citations
│   │       └── stats/route.ts                # GET { documents, chunks, text/image/table }
│   ├── components/ui/                  # shadcn/ui (button, card, input, textarea, badge,
│   │                                   #   separator, scroll-area, skeleton, toast, toaster)
│   ├── hooks/use-toast.ts
│   └── lib/
│       ├── text-extractor.ts            # pdfjs-dist → [{ pageNumber, text }]
│       ├── image-extractor.ts           # Figure X → [{ pageNumber, figureLabel, desc }]
│       ├── table-detector.ts             # pipe + tab tables → [{ pageNumber, label, rows, markdown }]
│       ├── chunker-multimodal.ts        # combine three modalities → DocumentChunk rows
│       ├── chunker.ts                   # splitBodyByTokens (text modality only)
│       ├── tokenizer.ts                 # lowercase + md-strip + CJK + stop words
│       ├── embeddings.ts                # hashing-trick (default) + OpenAI-compat
│       ├── bm25.ts                      # Okapi BM25
│       ├── hybrid-search.ts             # RRF fusion
│       ├── retrieval.ts                 # in-memory corpus cache + retrieve()
│       ├── ai.ts                        # ChatProvider + multimodal system prompt + citations
│       ├── citation.ts                 # parseCitations + formatCitationCard + modality badges
│       ├── ingest.ts                    # PDF → chunks → embed → persist
│       ├── db.ts                        # Prisma client singleton
│       ├── utils.ts                     # cn()
│       └── __tests__/                   # 52 unit tests across 10 files
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json
├── eslint.config.mjs
├── .env.example
├── LICENSE
└── README.md
```

## Case Study

**Problem:** Production PDFs are not just text — they mix prose, embedded
figures (with "Figure X" captions), and tabular data (either as real
markdown-style tables or as copy-pasted tab-separated spreadsheet output).
A text-only RAG over such PDFs silently drops two of the three
modalities: figures vanish entirely (their captions are sometimes the
only signal that an image ever existed), and tables are flattened into
un-tokenisable soup that no embedding model can match against a query
like "what was Q4 revenue?". Even when text extraction succeeds, the user
has no way to verify which page a claim came from because the page
metadata is usually discarded during chunking.

**Approach:** Treat the PDF as a stream of pages, and per page derive
three parallel inputs — a text body, a list of figure placeholders, and a
list of detected tables — then combine them into a single chunk stream
where every chunk carries `modality`, `pageNumber`, `heading`, and
`content`. Store all three modalities in the **same** `DocumentChunk`
table so the retrieval index is modality-agnostic. The chat system
prompt tells the LLM about each chunk's modality + page number so it can
emit `[^c1]` markers that resolve back to a citation card with the
modality badge + page. When the user clicks a citation, the per-page
source view (`GET /api/documents/[id]/pages/[page]`) reconstructs the
page from the stored chunks and renders the text + image placeholder
boxes + table markdown — closing the grounding loop without ever
re-parsing the PDF.

**Multimodal chunking details:** ordering within a page is text → table
→ image (text first because it's the bulk of the page; tables next
because they usually appear right after the prose that introduces them;
images last because their placeholder text is short and acts as a "see
Figure X on page N" pointer). The `ordinal` counter is threaded across
pages by `chunkDocument` so the final chunk list is 1..N.

**Visual citations details:** each citation chip shows the modality badge
(TEXT=neutral, IMAGE=amber, TABLE=emerald) + page number inline, and the
expanded citation card below the message shows the filename, heading,
and a 180-char preview. The modality badge colour choices deliberately
avoid indigo/blue per the project styling rules — TEXT is neutral so the
rare-but-important image and table chunks stand out visually.

**Differentiation from a generic PDF RAG:** three modalities in one
`DocumentChunk` table (instead of separate text/image/table tables that
need separate retrievers); page-level metadata preserved end-to-end so
the citation → page view loop closes; a table detector that handles both
markdown-style pipe tables and "ugly" copy-pasted tab-separated tables
that never went through a markdown pretty-printer; and an image
placeholder pattern that keeps the image chunks retrievable without
requiring a real image extraction pipeline.

**Outcome:** 52 unit tests, sub-200ms suite, no external API keys needed
for the default experience, real semantic embeddings when you opt in,
and a fully streaming chat with modality-tagged citations that point
straight back to the source page.

### What I'd do differently

- **Real CLIP embeddings for image chunks** — the MVP stores a
  placeholder description and embeds that. A real CLIP/BLIP-2 pass over
  the actual cropped image region would let users query "the chart with
  the red line going up" and retrieve the right figure chunk.
- **ColPali-style page-level multi-vector retrieval** — the MVP chunks
  per page (text + image + table) and retrieves at the chunk level. A
  ColPali-style approach would embed each page as a sequence of
  multi-vector patches and retrieve at the page level first, then drill
  into the chunk — better for queries that span a figure and its
  surrounding paragraph.
- **Real image extraction** — the MVP detects "Figure X" mentions and
  stores placeholders. A production build would rasterise the figure's
  bounding box out of the PDF page and call `createVision` for a real
  description. The seam (`describeImage` in `ai.ts`) is already there;
  only the bbox extraction + image bytes pipeline is missing.
- **Chart understanding** — figures that are actually charts (line /
  bar / pie) deserve a dedicated vision pass that extracts axis labels,
  series, and trends. The current MVP lumps them all under "image
  placeholder".
- **Table structure model** — replace the pipe/tab heuristic with a
  real table-structure detector (e.g. TableTransformer or Camelot) for
  PDFs whose tables are rendered as positioned text spans rather than
  explicit separators.

## Resume Bullet

> Built Multimodal RAG — a PDF RAG that ingests text, images (as Figure X
> placeholders), and tables (pipe- or tab-separated) into a single chunk
> table with per-chunk modality + page metadata, retrieves via hybrid
> BM25 + vector with RRF fusion, and streams answers with visual
> citations that carry a modality badge + page number and link to a
> per-page source view. 52 unit tests, sub-200ms suite, runs fully
> offline (no API keys required).

## License

MIT — see [LICENSE](LICENSE).

## Push to GitHub

```bash
gh repo create multimodal-rag --public --source=. --remote=origin --push
```
