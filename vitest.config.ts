import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/tests/setup/build.ts"],
    setupFiles: ["./src/tests/setup/home.ts"],
    // Many tests spawn real git and the built CLI; under full-suite parallel load they run several
    // times slower than alone, so the 5s default fails them on slowness, not on a hang.
    testTimeout: 20_000,
    // Item worktrees live under .worktrees/ inside the checkout; without this the suite also runs
    // every worktree's copy of the tests, doubling the load and the run time.
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
