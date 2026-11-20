import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = process.env.WATERWISE_BACKEND_URL ?? "http://127.0.0.1:4000";
    return ["/api/waterwise/demo", "/api/waterwise/agent", "/api/waterwise/requests/:path*"].map((source) => ({
      source,
      destination: new URL(source, backend).href,
    }));
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
