import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Multimodal RAG — Text + Image + Table",
  description:
    "Enterprise RAG over PDF documents that ingests text, images (as Figure X placeholders), and tables (pipe- or tab-separated) into a single chunk table, then answers questions with hybrid BM25 + vector retrieval fused via RRF and inline citations that carry a modality badge + page number.",
  keywords: [
    "RAG",
    "multimodal RAG",
    "PDF ingestion",
    "table extraction",
    "figure detection",
    "Next.js",
    "Prisma",
    "z-ai-web-dev-sdk",
    "hybrid retrieval",
    "RRF",
  ],
  authors: [{ name: "Multimodal RAG" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
