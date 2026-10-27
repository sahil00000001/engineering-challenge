import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Browser tests share one Chromium per file and render real fonts; give them room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
