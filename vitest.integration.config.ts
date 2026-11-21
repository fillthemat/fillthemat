import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Bun's external-module interop loses Zod's named namespace export.
    server: { deps: { inline: ["zod"] } },
    environment: "node",
    include: ["src/**/*.integration.test.ts", "scripts/**/*.integration.test.ts"],
    setupFiles: ["./src/test/tracing.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
