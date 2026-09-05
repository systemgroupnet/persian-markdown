import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Keeps `web/dist/.gitkeep` alive across builds.
 *
 * `go:embed all:dist` fails to COMPILE if the directory has no files, so a
 * placeholder is committed to make a fresh clone buildable before anyone has
 * run `pnpm build`. Vite empties outDir on every build and takes the
 * placeholder with it, which silently reintroduces the broken-clone problem
 * the next time someone commits. Recreating it here keeps the guarantee.
 */
function keepEmbedPlaceholder(): Plugin {
  return {
    name: "pmd-keep-embed-placeholder",
    apply: "build",
    closeBundle() {
      writeFileSync(resolve(fileURLToPath(new URL("./dist", import.meta.url)), ".gitkeep"), "");
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), keepEmbedPlaceholder()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Go embeds web/dist via go:embed — this must never change without
    // updating web/embed.go in lockstep.
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3030",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
