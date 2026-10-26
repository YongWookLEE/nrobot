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
  // 실행에 필요한 자료는 위에서 한정한다. 원본 자료·작업 임시물은 배포하지 않는다.
  outputFileTracingExcludes: {
    "/*": [
      "./.dryforge", "./.dryforge/**/*", "./.git", "./.git/**/*", "./.env*",
      "./private/prices/**/*", "./private/reference/**/*", "./private/compare/**/*", "./private/golden/**/*",
      "./tests/**/*", "./tools/**/*",
    ],
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
