import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so assets need that base.
  // Cloudflare Pages serves from the root; override with BASE=/ if we move.
  base: process.env.BASE ?? "/teambalance/",
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
