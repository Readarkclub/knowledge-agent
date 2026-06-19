import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@huggingface/transformers"],
  outputFileTracingIncludes: {
    "/*": ["./data/index.json"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
