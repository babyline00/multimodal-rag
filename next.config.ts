import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  // pdfjs-dist ships a web worker; we run extraction server-side only so this
  // is mostly a hint to webpack not to bundle the worker entry on the client.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
