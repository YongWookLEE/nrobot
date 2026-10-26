import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/*": ["./generated/pricelists/**/*.json", "./generated/pricelists/images/*"],
    "/api/catalog-image/*": ["./generated/pricelists/**/*"],
    "/api/generate": ["./generated/pricelists/**/*", "./private/fonts/*.ttf", "./assets/fonts/*.ttf", "./assets/images/*", "./assets/layout/*.json"],
  },
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
