import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // For domain tests: pure TS, no Workers needed.
    // For integration/e2e tests with D1: use poolMatchGlobs or separate config.
  },
});
