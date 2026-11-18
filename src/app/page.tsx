"use client";

/**
 * Single visible route — 3-column multimodal RAG workspace.
 *
 * Layout:
 *   - Top: header with "Upload PDF" + corpus stats (documents / chunks /
 *     image chunks / table chunks).
 *   - Left: document list with page count + chunk breakdown (text / image /
 *     table counts). Checkbox tick filters retrieval to a subset.
 *   - Center: chat column with streaming + citation chips. Citations carry a
 *     modality badge (TEXT / IMAGE / TABLE) + page number + preview.
 *   - Right: per-page source view (toggled when a citation chip is clicked) —
 *     shows the extracted text + image placeholder boxes + rendered table
 *     markdown for that page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  ImageIcon,
  Table as TableIcon,
  Upload,
  Send,
  Trash2,
  X,
  FileUp,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ----- shared types (mirror the API contracts) -----

interface DocumentItem {
  id: string;
  filename: string;
  source: string;
  pageCount: number;
  ingestedAt: string;
  chunks: number;
  textChunks: number;
  imageChunks: number;
  tableChunks: number;
}
interface Stats {
  documents: number;
  chunks: number;
  textChunks: number;
  imageChunks: number;
  tableChunks: number;
}
interface Citation {
  chunkId: string;
  shortId: string;
  documentId: string;
  filename: string;
  modality: "text" | "image" | "table";
  modalityBadge: "TEXT" | "IMAGE" | "TABLE";
  ordinal: number;
  pageNumber: number;
  heading: string | null;
  preview: string;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  sessionId?: string;
}
interface PageView {
  documentId: string;
  filename: string;
  pageNumber: number;
  pageCount: number;
  text: string;
  images: { chunkId: string; figureLabel: string; descriptionPlaceholder: string }[];
  tables: { chunkId: string; label: string; markdown: string }[];
  figureMentions: string[];
  tableMentions: string[];
}

const MODALITY_BADGE_CLASS = {
  text: "bg-secondary text-secondary-foreground border-border",
  image:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  table:
    "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
} as const;

// ----- main component -----

export default function Page() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pageView, setPageView] = useState<PageView | null>(null);
  const [pageViewLoading, setPageViewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ---- initial fetch ----
  const refreshDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const [d, s] = await Promise.all([
        fetch("/api/documents").then((r) => r.json()),
        fetch("/api/stats").then((r) => r.json()),
      ]);
      setDocuments(d.documents ?? []);
      setStats(s);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs]);

  // ---- chat scroll behaviour ----
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  // ---- upload ----
  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      setUploading(true);
      try {
        for (const f of Array.from(files)) {
          if (!f.name.toLowerCase().endsWith(".pdf")) {
            toast({ title: "Skipped non-PDF", description: f.name });
            continue;
          }
          const form = new FormData();
          form.append("file", f);
          const res = await fetch("/api/documents/import", { method: "POST", body: form });
          const json = await res.json();
          if (!res.ok) {
            toast({
              title: "Upload failed",
              description: json.error ?? "Unknown error",
              variant: "destructive",
            });
            continue;
          }
          toast({
            title: `Ingested ${json.filename}`,
            description: `${json.pageCount} pages • ${json.chunks} chunks (${json.textChunks} text / ${json.imageChunks} image / ${json.tableChunks} table)`,
          });
        }
        await refreshDocs();
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refreshDocs, toast],
  );

  // ---- delete ----
  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Delete failed", variant: "destructive" });
        return;
      }
      setSelectedDocIds((prev) => prev.filter((d) => d !== id));
      await refreshDocs();
    },
    [refreshDocs, toast],
  );

  // ---- send chat message ----
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setStreaming(true);
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: text, sessionId: sessionId ?? undefined };
    setMessages((prev) => [...prev, userMsg]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: sessionId ?? undefined,
        filterDocumentIds: selectedDocIds.length ? selectedDocIds : undefined,
      }),
    });
    if (!res.ok || !res.body) {
      setStreaming(false);
      toast({ title: "Chat failed", description: `HTTP ${res.status}`, variant: "destructive" });
      return;
    }
    const newSessionId = res.headers.get("X-Session-Id");
    if (newSessionId) setSessionId(newSessionId);

    // Append an empty assistant message that we grow as tokens arrive.
    let assistantContent = "";
    let assistantCitations: Citation[] = [];
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Look for the ---CITATIONS--- footer to split the body.
      const footerIdx = buffer.indexOf("\n\n---CITATIONS---\n");
      let body = buffer;
      let footerJson = "";
      if (footerIdx >= 0) {
        body = buffer.slice(0, footerIdx);
        footerJson = buffer.slice(footerIdx + "\n\n---CITATIONS---\n".length);
        buffer = "";
      } else {
        buffer = "";
      }
      if (body) {
        assistantContent += body;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: assistantContent,
            citations: assistantCitations,
            sessionId: newSessionId ?? undefined,
          };
          return next;
        });
      }
      if (footerJson) {
        try {
          const parsed = JSON.parse(footerJson);
          assistantCitations = parsed.citations ?? [];
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: assistantContent,
              citations: assistantCitations,
              sessionId: newSessionId ?? undefined,
            };
            return next;
          });
        } catch {
          /* ignore partial footer */
        }
      }
    }
    setStreaming(false);
  }, [input, streaming, sessionId, selectedDocIds, toast]);

  // ---- citation click → open page view ----
  const openPageView = useCallback(
    async (citation: Citation) => {
      setPageViewLoading(true);
      try {
        const res = await fetch(
          `/api/documents/${citation.documentId}/pages/${citation.pageNumber}`,
        );
        if (!res.ok) {
          toast({ title: "Could not load page view", variant: "destructive" });
          return;
        }
        const data: PageView = await res.json();
        setPageView(data);
      } finally {
        setPageViewLoading(false);
      }
    },
    [toast],
  );

  const toggleDoc = useCallback((id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ---- top header ---- */}
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ScrollText className="size-6 text-primary" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">
                Multimodal RAG
                <span className="text-muted-foreground font-normal text-sm"> — Text + Image + Table</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Hybrid BM25 + vector retrieval over PDF documents with inline citations carrying modality + page metadata.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <StatsBadges stats={stats} />
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm">
              {uploading ? (
                <>
                  <FileUp className="size-4 animate-pulse" /> Uploading…
                </>
              ) : (
                <>
                  <Upload className="size-4" /> Upload PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* ---- main 3-column workspace ---- */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_360px] gap-px bg-border min-h-0">
        {/* left column — document list */}
        <section className="bg-card overflow-hidden flex flex-col min-h-0 max-h-[calc(100vh-64px)]">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Documents</h2>
            <p className="text-xs text-muted-foreground">
              Tick to scope retrieval. Click to delete.
            </p>
          </div>
          <ScrollArea className="flex-1 scrollbar-thin">
            <div className="p-2 space-y-2 max-h-[calc(100vh-130px)] overflow-y-auto scrollbar-thin">
              {loadingDocs && documents.length === 0 ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : documents.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground text-center">
                  No documents yet. Upload a PDF to start.
                </div>
              ) : (
                documents.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    selected={selectedDocIds.includes(d.id)}
                    onToggle={() => toggleDoc(d.id)}
                    onDelete={() => handleDelete(d.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </section>

        {/* center column — chat */}
        <section className="bg-background flex flex-col min-h-0 max-h-[calc(100vh-64px)]">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Chat</h2>
            {selectedDocIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                scoped to {selectedDocIds.length} doc{selectedDocIds.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
            {messages.length === 0 ? (
              <EmptyChatState />
            ) : (
              messages.map((m, i) => (
                <MessageBubble key={i} message={m} onCitationClick={openPageView} />
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t p-3 flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a question about your PDFs..."
              className="min-h-[44px] max-h-40 resize-none"
              disabled={streaming}
            />
            <Button onClick={handleSend} disabled={streaming || !input.trim()} size="icon">
              <Send className="size-4" />
            </Button>
          </div>
        </section>

        {/* right column — per-page source view (hidden on small screens when no page is open) */}
        <section
          className={cn(
            "bg-card overflow-hidden flex-col min-h-0 max-h-[calc(100vh-64px)]",
            "hidden lg:flex",
          )}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Page view</h2>
            {pageView && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setPageView(null)}
                aria-label="Close page view"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1 scrollbar-thin">
            <div className="p-4 space-y-4 max-h-[calc(100vh-130px)] overflow-y-auto scrollbar-thin">
              {pageViewLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-1/2" />
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : !pageView ? (
                <p className="text-xs text-muted-foreground text-center p-4">
                  Click a citation chip in the chat to open the source page here.
                </p>
              ) : (
                <PageViewContent view={pageView} />
              )}
            </div>
          </ScrollArea>
        </section>
      </main>
    </div>
  );
}

// ----- sub-components -----

function StatsBadges({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  return (
    <div className="hidden md:flex items-center gap-2 text-xs">
      <Badge variant="outline" className="gap-1">
        <FileText className="size-3" /> {stats.documents} docs
      </Badge>
      <Badge variant="outline" className="gap-1">
        {stats.chunks} chunks
      </Badge>
      <Badge variant="outline" className={cn("gap-1", MODALITY_BADGE_CLASS.text)}>
        <FileText className="size-3" /> {stats.textChunks} text
      </Badge>
      <Badge variant="outline" className={cn("gap-1", MODALITY_BADGE_CLASS.image)}>
        <ImageIcon className="size-3" /> {stats.imageChunks} image
      </Badge>
      <Badge variant="outline" className={cn("gap-1", MODALITY_BADGE_CLASS.table)}>
        <TableIcon className="size-3" /> {stats.tableChunks} table
      </Badge>
    </div>
  );
}

function DocumentCard({
  doc,
  selected,
  onToggle,
  onDelete,
}: {
  doc: DocumentItem;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs space-y-2 transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-card hover:bg-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onToggle}
          className="flex items-start gap-2 text-left flex-1 min-w-0"
          aria-pressed={selected}
        >
          <span
            className={cn(
              "mt-0.5 size-3 shrink-0 rounded border flex items-center justify-center",
              selected ? "bg-primary border-primary" : "border-border",
            )}
          >
            {selected && (
              <svg viewBox="0 0 12 12" className="size-2.5 text-primary-foreground" aria-hidden>
                <path d="M2.5 6.5L5 9l4-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <div className="font-medium truncate" title={doc.filename}>
              {doc.filename}
            </div>
            <div className="text-muted-foreground text-[11px]">
              {doc.pageCount}p · {doc.chunks} chunks
            </div>
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={onDelete}
          aria-label="Delete document"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1 pl-5">
        <Badge variant="outline" className={cn("text-[10px]", MODALITY_BADGE_CLASS.text)}>
          <FileText className="size-2.5" /> {doc.textChunks}
        </Badge>
        <Badge variant="outline" className={cn("text-[10px]", MODALITY_BADGE_CLASS.image)}>
          <ImageIcon className="size-2.5" /> {doc.imageChunks}
        </Badge>
        <Badge variant="outline" className={cn("text-[10px]", MODALITY_BADGE_CLASS.table)}>
          <TableIcon className="size-2.5" /> {doc.tableChunks}
        </Badge>
      </div>
    </div>
  );
}

function EmptyChatState() {
  return (
    <div className="text-center text-sm text-muted-foreground py-12 space-y-2">
      <ScrollText className="size-10 mx-auto opacity-40" />
      <p className="font-medium text-foreground">No messages yet</p>
      <p className="text-xs">
        Upload a PDF, then ask a question. Citations will appear inline with a
        modality badge (TEXT / IMAGE / TABLE) and page number.
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage;
  onCitationClick: (c: Citation) => void;
}) {
  const isUser = message.role === "user";
  // Render inline [^c1] markers as clickable chips.
  const parts = renderWithCitations(message.content);
  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card border",
        )}
      >
        {parts.map((part, i) =>
          part.kind === "text" ? (
            <span key={i}>{part.value}</span>
          ) : (
            <CitationChip
              key={i}
              shortId={part.value}
              citation={message.citations?.find((c) => c.shortId === part.value)}
              onClick={onCitationClick}
            />
          ),
        )}
      </div>
      {!isUser && message.citations && message.citations.length > 0 && (
        <div className="max-w-[85%] space-y-1.5">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Citations
          </div>
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <CitationCardView key={c.chunkId} citation={c} onClick={onCitationClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CitationChip({
  shortId,
  citation,
  onClick,
}: {
  shortId: string;
  citation?: Citation;
  onClick: (c: Citation) => void;
}) {
  if (!citation) {
    return (
      <sup className="text-[10px] text-muted-foreground ml-0.5">[^{shortId}]</sup>
    );
  }
  return (
    <button
      onClick={() => onClick(citation)}
      className={cn(
        "inline-flex items-center gap-0.5 ml-0.5 px-1 rounded text-[10px] align-super border cursor-pointer hover:scale-[1.04] transition-transform",
        MODALITY_BADGE_CLASS[citation.modality],
      )}
      title={`${citation.modalityBadge} · page ${citation.pageNumber} · ${citation.filename}`}
    >
      {citation.modalityBadge} p{citation.pageNumber}
    </button>
  );
}

function CitationCardView({
  citation,
  onClick,
}: {
  citation: Citation;
  onClick: (c: Citation) => void;
}) {
  return (
    <button
      onClick={() => onClick(citation)}
      className={cn(
        "flex items-start gap-2 max-w-full text-left rounded-md border px-2 py-1.5 text-[11px] cursor-pointer hover:bg-accent/50 transition-colors",
        MODALITY_BADGE_CLASS[citation.modality],
      )}
    >
      <Badge variant="outline" className={cn("shrink-0 text-[10px]", MODALITY_BADGE_CLASS[citation.modality])}>
        {citation.modalityBadge} · p{citation.pageNumber}
      </Badge>
      <div className="min-w-0">
        <div className="font-medium truncate" title={citation.filename}>
          {citation.filename}
          {citation.heading ? ` · ${citation.heading}` : ""}
        </div>
        <div className="text-muted-foreground line-clamp-2">{citation.preview}</div>
      </div>
    </button>
  );
}

function PageViewContent({ view }: { view: PageView }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">
          {view.filename} · page {view.pageNumber} of {view.pageCount}
        </div>
        <Separator className="my-2" />
      </div>

      {view.images.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Images
          </h3>
          {view.images.map((img) => (
            <div key={img.chunkId} className="space-y-1.5">
              <div className="text-xs font-medium">{img.figureLabel}</div>
              <div className="image-placeholder-box">
                <div>
                  <ImageIcon className="size-6 mx-auto mb-1 opacity-60" />
                  {img.figureLabel} — placeholder
                </div>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2">
                {img.descriptionPlaceholder}
              </div>
            </div>
          ))}
        </div>
      )}

      {view.tables.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Tables
          </h3>
          {view.tables.map((t) => (
            <div key={t.chunkId} className="space-y-1">
              <div className="text-xs font-medium">{t.label}</div>
              <pre className="text-xs bg-muted/40 rounded-md p-2 overflow-x-auto whitespace-pre">
                {t.markdown}
              </pre>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          Page text
        </h3>
        <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/30 rounded-md p-3 max-h-72 overflow-y-auto scrollbar-thin">
          {view.text || "(no extractable text on this page)"}
        </pre>
      </div>
    </div>
  );
}

// ----- helpers -----

type RenderPart =
  | { kind: "text"; value: string }
  | { kind: "citation"; value: string };

function renderWithCitations(message: string): RenderPart[] {
  if (!message) return [{ kind: "text", value: "" }];
  const parts: RenderPart[] = [];
  const re = /\[\^(c\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    if (m.index > last) {
      parts.push({ kind: "text", value: message.slice(last, m.index) });
    }
    parts.push({ kind: "citation", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < message.length) {
    parts.push({ kind: "text", value: message.slice(last) });
  }
  return parts;
}
