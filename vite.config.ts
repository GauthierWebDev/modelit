import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Identité de l'application (À propos), avec package.json pour seule source.
  define: {
    __APP_INFO__: JSON.stringify({
      version: pkg.version,
      author: pkg.author,
      license: pkg.license,
      homepage: pkg.homepage,
      bugs: pkg.bugs,
    }),
  },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Encodeur WebP en WebAssembly : le fichier .wasm doit être résolu par Vite, pas pré-empaqueté.
  optimizeDeps: { exclude: ["@jsquash/webp"] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // WebView2 (Windows) ; WKWebView / WebKitGTK ailleurs. Safari 16.4 : minimum de Tailwind 4,
    // cohérent avec `bundle.macOS.minimumSystemVersion` (macOS 13.3).
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome111" : "safari16.4",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    // Worklet du vocal (O-48) : un vrai fichier, jamais une URL `data:` que la CSP
    // (`script-src 'self'`) refuserait au chargement du module audio.
    assetsInlineLimit: (file) => (file.endsWith("voiceWorklet.js") ? false : undefined),
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Runners de CI plus lents : PGlite et le placement automatique dépassent parfois 5 s.
    ...(process.env.CI ? { testTimeout: 30_000 } : {}),
  },
});
