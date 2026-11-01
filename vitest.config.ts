import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/tests/setup/build.ts"],
    setupFiles: ["./src/tests/setup/home.ts"],
    // Many tests spawn real git and the built CLI; under full-suite parallel load they run several
    // times slower than alone, so the 5s default fails them on slowness, not on a hang.
    testTimeout: 20_000,
  },
});
