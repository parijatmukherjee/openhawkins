import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        // `bin/**` are CLI entrypoints exercised by the black-box functional suite
        // in a separate process, so they cannot be instrumented by the in-process
        // unit run — they are covered end-to-end (test-functional/*.e2e.test.ts).
        "packages/*/src/bin/**",
        // Optional-peer-backed embedder: only runs when @huggingface/transformers is
        // installed; excluded from the coverage gate (lazy import, never executed in
        // the in-process unit suite without the optional package).
        "packages/*/src/transformers-embedder.ts",
        // Runtime-selection glue: thin dispatch that picks a concrete driver at
        // startup based on env vars — tested end-to-end, not unit-instrumented.
        "packages/*/src/driver/select.ts",
        // Type-only modules: nothing but `interface`/`type` declarations, which
        // erase to no runtime code — there are no statements or branches to cover.
        "packages/*/src/loop/turn.ts",
        "packages/*/src/models/adapter.ts",
        "packages/*/src/tools/tool.ts",
        "packages/*/src/fragment.ts",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      // The merge gate: coverage MUST stay above these floors (enforced locally,
      // in Docker, and in CI). Lines/statements/functions are held at >99%.
      thresholds: {
        statements: 99,
        lines: 99,
        functions: 99,
        branches: 99,
      },
    },
  },
});
