import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@git-mosaic/calendar": fileURLToPath(
        new URL("./packages/calendar/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/core/preview": fileURLToPath(
        new URL("./packages/core/src/preview.ts", import.meta.url),
      ),
      "@git-mosaic/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/image": fileURLToPath(
        new URL("./packages/image/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/git": fileURLToPath(
        new URL("./packages/git/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/github": fileURLToPath(
        new URL("./packages/github/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/renderer": fileURLToPath(
        new URL("./packages/renderer/src/index.ts", import.meta.url),
      ),
      "@git-mosaic/schemas/plan-integrity": fileURLToPath(
        new URL("./packages/schemas/src/plan-integrity.ts", import.meta.url),
      ),
      "@git-mosaic/schemas": fileURLToPath(
        new URL("./packages/schemas/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: { reporter: ["text", "json", "html"] },
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
