import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Agent runs can leave a git worktree under .claude/worktrees/, which is a
    // full duplicate of src/. Without this, vitest collects those copies too and
    // silently runs stale versions of every test alongside the real ones — a
    // left-behind worktree from five days earlier was inflating the suite from
    // 160 tests to 252. Excluding the directory rather than deleting it by hand
    // means the next leftover cannot do the same thing.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
