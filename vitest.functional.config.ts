import { defineConfig } from "vitest/config";

// Functional / end-to-end tests. Unlike the unit suite (vitest.config.ts), these
// spawn the REAL built artifacts (the compiled CLI / single binary) as
// subprocesses and assert on their actual output — exercising the system exactly
// as a user would. They require `npm run build` to have produced dist/ first,
// and they are slower, so they run as a separate suite (`npm run test:functional`).
export default defineConfig({
  test: {
    include: ["packages/*/test-functional/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
