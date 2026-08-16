import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    // The design-locked reference is intentionally dependency-free.  Resolve
    // its Tailwind import through the V2 build's installed v4 adapter without
    // adding a node_modules tree to the reference source.
    alias: {
      tailwindcss: resolve(
        process.cwd(),
        "node_modules/@tailwindcss/vite/node_modules/tailwindcss/index.css",
      ),
    },
  },
  // Root V1 still uses Tailwind v3 through PostCSS.  The V2 visual foundation
  // is compiled by the v4 Vite adapter, so it must not be processed a second
  // time by that unrelated root configuration.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: path.resolve(import.meta.dirname, "../../dist-v2-ui"),
    emptyOutDir: true,
  },
});
